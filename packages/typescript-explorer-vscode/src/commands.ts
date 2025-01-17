import {
    iconColorsEnabled,
    iconsEnabled,
    selectionEnabled,
    showBaseClassInfo,
    showTypeParameterInfo,
} from "./config"
import * as vscode from "vscode"
import { StateManager } from "./state/stateManager"
import { LocalizedTypeInfo, TypeInfoResolver } from "@ts-type-explorer/api"
import { getTypeTreeAtLocation } from "./server"

type CommandHandler = (...args: unknown[]) => void | Thenable<void>
type CommandInfo = [id: string, handler: CommandHandler]

const commandList: CommandInfo[] = [
    [
        "typescriptExplorer.typeTree.view.icons.enabled.toggle",
        iconsEnabled.toggle,
    ],
    [
        "typescriptExplorer.typeTree.view.icons.colors.enabled.toggle",
        iconColorsEnabled.toggle,
    ],
    [
        "typescriptExplorer.typeTree.view.show.typeParameters.toggle",
        showTypeParameterInfo.toggle,
    ],
    [
        "typescriptExplorer.typeTree.view.show.baseClass.toggle",
        showBaseClassInfo.toggle,
    ],
    [
        "typescriptExplorer.typeTree.selection.enable.toggle",
        selectionEnabled.toggle,
    ],
]

export function registerCommands(context: vscode.ExtensionContext, stateManager: StateManager) {
    const commands = [
        ...commandList,
        [
            "typescriptExplorer.copyTypeAsTypescriptType",
            () => copyTypeAsTypescriptType(stateManager),
        ]
    ]

    commands.forEach((c) => registerCommand(c as any, context))
}

function registerCommand(
    [id, handler]: CommandInfo,
    context: vscode.ExtensionContext
) {
    // @ts-ignore
    context.subscriptions.push(vscode.commands.registerCommand(id, handler))
}

async function copyTypeAsTypescriptType(stateManager: StateManager) {
    const typeInfo = stateManager.getTypeTree()
    const typeInfoResolver = stateManager.typeTreeProvider?.getTypeInfoResolver()

    if (!typeInfo || !typeInfoResolver) {
        vscode.window.showInformationMessage("No type information available.")
        return
    }

    try {
        const localizedTypeInfo = await typeInfoResolver.localize(typeInfo)
        const flattenedType = await generateFlattenedTypeDefinition(localizedTypeInfo, typeInfoResolver)
        // @ts-ignore
        await formatAndCopyToClipboard(`type ${typeInfo.symbolMeta.name} = ${flattenedType}`)
        vscode.window.showInformationMessage("Flattened type copied to clipboard!")
    } catch (error) {
        vscode.window.showErrorMessage("Failed to copy type information.")
        console.error("Error copying to clipboard:", error)
    }
}

async function generateFlattenedTypeDefinition(
    info: LocalizedTypeInfo,
    resolver: TypeInfoResolver,
    seenRefs: Set<string> = new Set()
): Promise<string> {
    // Handle cycles in type references
    if (info._id && seenRefs.has(info._id)) {
        return 'any // Circular reference'
    }
    if (info._id) {
        seenRefs.add(info._id)
    }

    // Handle reference types
    // @ts-ignore
    if (info.kind === 'reference' && info.location) {
        // @ts-ignore
        const resolvedTypeInfo = await resolver.localize(await getTypeTreeAtLocation(info.locations[0]))
        if (resolvedTypeInfo) {
            return generateFlattenedTypeDefinition(resolvedTypeInfo, resolver, seenRefs)
        }
        return 'any // Failed to resolve reference'
    }

    // Handle primitive types
    if (info.kind === 'primitive') {
        return info.primitiveKind ?? 'any'
    }

    // Handle object types
    if (info.kind === 'object') {
        const children = await resolver.localizeChildren(info)
        if (!children.length) return '{}'

        const properties = await Promise.all(
            children.map(async child => {
                if ('error' in child) return null
                const propertyName = child.symbol?.name ?? 'unknown'
                const propertyType = await generateFlattenedTypeDefinition(child, resolver, seenRefs)
                const optional = child.optional ? '?' : ''
                return `${propertyName}${optional}: ${propertyType}`
            })
        )

        const validProperties = properties.filter(p => p !== null)
        return `{ ${validProperties.join('; ')} }`
    }

    // Handle array types
    if (info.kind === 'array') {
        const children = await resolver.localizeChildren(info)
        if (children.length === 0) return 'any[]'

        const elementType = await generateFlattenedTypeDefinition(children[0], resolver, seenRefs)
        return `${elementType}[]`
    }

    // Handle tuple types
    if (info.kind === 'tuple') {
        const children = await resolver.localizeChildren(info)
        const types = await Promise.all(
            children.map(child => generateFlattenedTypeDefinition(child, resolver, seenRefs))
        )
        return `[${types.join(', ')}]`
    }

    // Handle union types
    if (info.kind === 'union') {
        const children = await resolver.localizeChildren(info)
        const types = await Promise.all(
            children.map(child => generateFlattenedTypeDefinition(child, resolver, seenRefs))
        )
        return types.join(' | ')
    }

    // Handle intersection types
    if (info.kind === 'intersection') {
        const children = await resolver.localizeChildren(info)
        const types = await Promise.all(
            children.map(child => generateFlattenedTypeDefinition(child, resolver, seenRefs))
        )
        return types.join(' & ')
    }

    // Handle string literal types
    if (info.kind === 'string_literal') {
        // @ts-ignore
        return `"${info.value}"`
    }

    // Handle number literal types
    if (info.kind === 'number_literal') {
        // @ts-ignore
        return info.value.toString()
    }

    // Handle boolean literal types
    if (info.kind === 'boolean_literal') {
        // @ts-ignore
        return info.value.toString()
    }

    return 'any'
}

async function formatAndCopyToClipboard(content: string) {
    // Create a temporary untitled document with TypeScript language
    const document = await vscode.workspace.openTextDocument({
        language: 'typescript',
        content: content
    });

    // Format the document using VSCode's formatting provider
    const formatted = await vscode.commands.executeCommand(
        'vscode.executeFormatDocumentProvider',
        document.uri
    ) as vscode.TextEdit[];

    // Apply the formatting edits
    const edit = new vscode.WorkspaceEdit();
    if (formatted) {
        edit.set(document.uri, formatted);
        await vscode.workspace.applyEdit(edit);
    }

    // Get the formatted text
    const formattedText = document.getText();

    // Copy to clipboard
    await vscode.env.clipboard.writeText(formattedText);

    // Close the temporary document
    // Briefly show the document to make its editor active
    await vscode.window.showTextDocument(document.uri, { preview: true, preserveFocus: false });
    // Immediately close the active editor
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}
