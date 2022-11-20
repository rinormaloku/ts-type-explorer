import { LocalizedTypeInfo, localizePurpose } from "@ts-type-explorer/api"
import {
    iconsEnabled,
    iconColorsEnabled,
    readonlyEnabled,
    descriptionTypeArgumentsEnabled,
    descriptionTypeArgumentsMaxLength,
} from "../config"
import * as vscode from "vscode"

const {
    None: NoChildren,
    Expanded,
    Collapsed,
} = vscode.TreeItemCollapsibleState

type TypeTreeItemContextValue = "declared"

type TypeTreeItemMeta = {
    label: string
    description?: string
    contextValue?: TypeTreeItemContextValue
    icon?: vscode.ThemeIcon
    collapsibleState: vscode.TreeItemCollapsibleState
}

export function getMeta(
    info: LocalizedTypeInfo,
    depth: number
): TypeTreeItemMeta {
    const label = getLabel(info)
    const description = getDescription(info)

    const collapsibleState = getCollapsibleState()

    return {
        label,
        description,
        contextValue: getContextValue(),
        icon: getIcon(),
        collapsibleState,
    }

    function getCollapsibleState() {
        if ((info.children?.length ?? 0) === 0) {
            return NoChildren
        }

        if (info.purpose === "jsx_properties") {
            return Expanded
        }

        return depth === 1 ? Expanded : Collapsed
    }

    function getContextValue(): TypeTreeItemContextValue | undefined {
        return info.locations && info.locations.length > 0
            ? "declared"
            : undefined
    }

    type IconId = [id: string, colorId?: string]

    function getIcon(): vscode.ThemeIcon | undefined {
        if (!iconsEnabled.get()) {
            return undefined
        }

        const iconIds = _getIcon()
        if (!iconIds) {
            return undefined
        }

        const [id] = iconIds
        let [colorId] = iconIds

        if (!iconColorsEnabled.get()) {
            colorId = "icon.foreground"
        }

        return !colorId
            ? new vscode.ThemeIcon(id)
            : new vscode.ThemeIcon(id, new vscode.ThemeColor(colorId))

        function _getIcon(): IconId | undefined {
            if (info.symbol?.property) {
                return ["symbol-field"]
            }

            if (info.symbol?.isArgument) {
                return ["symbol-property"]
            }

            switch (info.purpose) {
                case "class_constructor": {
                    return ["symbol-constructor"]
                }
            }

            switch (info.kind) {
                case "primitive": {
                    switch (info.primitiveKind) {
                        case "essymbol":
                        case "unique_symbol":
                        case "string": {
                            return ["symbol-string"]
                        }

                        case "bigint":
                        case "number": {
                            return ["symbol-numeric"]
                        }

                        case "boolean": {
                            return ["symbol-boolean"]
                        }

                        case "unknown":
                        case "any":
                        case "void":
                        case "undefined":
                        case "null": {
                            return ["symbol-null"]
                        }

                        case "never": {
                            return ["error", "symbolIcon.nullForeground"]
                        }

                        default: {
                            throw new Error("Unhandled primitive case")
                        }
                    }
                }

                case "object": {
                    return ["symbol-object"]
                }

                case "type_parameter": {
                    return ["symbol-type-parameter"]
                }

                case "string_mapping":
                case "template_literal":
                case "string_literal": {
                    return ["symbol-text"]
                }

                case "bigint_literal":
                case "number_literal": {
                    return ["symbol-number"]
                }

                case "boolean_literal": {
                    return ["symbol-boolean"]
                }

                case "enum": {
                    return ["symbol-enum"]
                }

                case "enum_literal": {
                    return ["symbol-enum-member"]
                }

                case "tuple":
                case "array": {
                    return ["symbol-array"]
                }

                case "intrinsic": {
                    return ["symbol-keyword"]
                }

                case "conditional": {
                    return ["question", "symbolIcon.keywordForeground"]
                }

                /* case "max_depth": {
                    return [ "ellipsis" ]
                } */

                case "substitution":
                case "non_primitive": {
                    return ["symbol-misc"]
                }

                case "union":
                case "intersection": {
                    return ["symbol-struct"]
                }

                case "signature":
                case "function": {
                    if (info.symbol?.insideClassOrInterface) {
                        return ["symbol-method"]
                    }

                    return ["symbol-function"]
                }

                case "interface": {
                    return ["symbol-interface"]
                }

                case "namespace": {
                    return ["symbol-namespace"]
                }

                case "module": {
                    return ["symbol-module"]
                }

                case "class": {
                    return ["symbol-class"]
                }

                case "index_info":
                case "indexed_access":
                case "index": {
                    return ["key", "symbolIcon.keyForeground"]
                }
            }

            return ["symbol-misc"]
        }
    }
}

type DescriptionParts = {
    alias?: string
    base?: string
    readonly?: boolean
}

function getDescription(info: LocalizedTypeInfo) {
    return descriptionPartsToString(getDescriptionParts(info))
}

export function getDescriptionWithTypeArguments(
    info: LocalizedTypeInfo,
    resolvedTypeArguments: LocalizedTypeInfo[]
) {
    const parts = getDescriptionParts(info)

    if (descriptionTypeArgumentsEnabled.get()) {
        if (parts.alias) {
            const args: string[] = []

            for (const arg of resolvedTypeArguments) {
                const { base, alias } = getDescriptionParts(arg)

                let baseText = alias ?? base ?? "???"

                if (
                    alias &&
                    arg.typeArguments &&
                    arg.typeArguments.length > 0
                ) {
                    baseText += "<...>"
                }

                args.push(baseText)
            }

            let argsText = args.join(", ")

            if (
                argsText.length >
                (descriptionTypeArgumentsMaxLength.get() ?? 10)
            ) {
                argsText = `...`
            }

            parts.alias += `<${argsText}>`
        }
    }

    return descriptionPartsToString(parts)
}

function getDescriptionParts(info: LocalizedTypeInfo): DescriptionParts {
    if (!info.kindText) {
        return {}
    }

    const decorate = (text: string) =>
        addDecorations(text, { dimension: info.dimension })

    const baseDescription = decorate(info.kindText)

    const nameOverridden = !!getLabelOverride(info)

    const aliasDescriptionBase =
        info.alias ??
        (nameOverridden && info.purpose !== "jsx_properties"
            ? info.symbol?.name
            : undefined)

    const aliasDescription =
        aliasDescriptionBase && decorate(aliasDescriptionBase)

    return {
        alias: aliasDescription,
        base: baseDescription,
        readonly: info.readonly && readonlyEnabled.get(),
    }
}

function descriptionPartsToString({
    alias,
    base,
    readonly,
}: DescriptionParts): string | undefined {
    if (!base) {
        return undefined
    }

    let result = alias ? `${alias} (${base})` : base

    if (readonly) {
        result = "readonly " + result
    }

    return result
}

function getLabel(info: LocalizedTypeInfo) {
    const base = getLabelBase(info)

    if (!base) {
        return base
    }

    return addDecorations(base, {
        optional: info.optional,
        rest: info.rest,
    })
}

function getLabelBase(info: LocalizedTypeInfo) {
    return (
        getLabelOverride(info) ??
        (!info.symbol?.anonymous ? info.symbol?.name ?? "" : "")
    )
}

function getLabelOverride(info: LocalizedTypeInfo) {
    return getLabelByName(info) ?? getLabelByPurpose(info)
}

function getLabelByName(info: LocalizedTypeInfo) {
    if (info.name !== undefined) {
        return info.name
    }

    return undefined
}

function getLabelByPurpose(info: LocalizedTypeInfo) {
    if (info.purpose) {
        return `<${localizePurpose(info.purpose)}>`
    }

    return undefined
}

function addDecorations(
    text: string,
    decorations: { rest?: boolean; optional?: boolean; dimension?: number }
) {
    const { rest = false, optional = false, dimension = 0 } = decorations

    text += "[]".repeat(dimension)

    if (optional) {
        text += "?"
    }

    if (rest) {
        text = "..." + text
    }

    return text
}
