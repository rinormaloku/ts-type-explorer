/* eslint-disable @typescript-eslint/require-await */

import { LocalizedTypeInfo, TypeInfoResolver } from "@ts-type-explorer/api"
import assert = require("assert")
import * as vscode from "vscode"
import { showTypeParameterInfo, showBaseClassInfo } from "../config"
import { markdownDocumentation } from "../markdown"
import { StateManager } from "../state/stateManager"
import { logError, rangeFromLineAndCharacters, showError } from "../util"
import { getQuickInfoAtLocation, getTypeTreeAtLocation } from "../server"
import {
    getDescriptionWithTypeArguments,
    getMeta,
} from "./typeTreeViewLocalizer"

export type TypeTreeChildrenUpdateInfo = {
    parent: TypeTreeItem | undefined
    children: TypeTreeItem[]
}

export class TypeTreeProvider implements vscode.TreeDataProvider<TypeTreeItem> {
    constructor(private stateManager: StateManager) {}

    private typeInfoResolver: TypeInfoResolver | undefined

    private _onDidChangeTreeData: vscode.EventEmitter<
        TypeTreeItem | undefined | null | void
    > = new vscode.EventEmitter()
    readonly onDidChangeTreeData: vscode.Event<
        TypeTreeItem | undefined | null | void
    > = this._onDidChangeTreeData.event

    private _onDidGetChildren: vscode.EventEmitter<TypeTreeChildrenUpdateInfo> =
        new vscode.EventEmitter()
    readonly onDidGetChildren: vscode.Event<TypeTreeChildrenUpdateInfo> =
        this._onDidGetChildren.event

    refresh(): void {
        this.typeInfoResolver = undefined
        this._onDidChangeTreeData.fire()
    }

    async getTreeItem(element: TypeTreeItem) {
        if (element.typeInfo.kind === "max_depth") {
            element.tooltip = "max depth exceeded"
        } else {
            if (element.typeInfo.locations) {
                for (const location of element.typeInfo.locations) {
                    const { documentation, tags } =
                        (await getQuickInfoAtLocation(location)) ?? {}

                    if (documentation && documentation.length > 0) {
                        element.tooltip = markdownDocumentation(
                            documentation,
                            tags ?? [],
                            vscode.Uri.file(location.fileName)
                        )
                        break
                    }
                }
            }

            if (
                element.typeInfo.typeArguments &&
                element.typeInfo.typeArguments.length > 0
            ) {
                const typeArguments = await this.localizeTypeInfoTypeArguments(
                    element.typeInfo
                )

                element.description = getDescriptionWithTypeArguments(
                    element.typeInfo,
                    typeArguments
                )
            }
        }

        return element
    }

    async getChildren(element?: TypeTreeItem): Promise<TypeTreeItem[]> {
        const children = await this.getChildrenWorker(element).catch((e) => {
            logError(e, "Error getting children")
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
            showError(e.message ?? "Error getting children")
            return []
        })

        this._onDidGetChildren.fire({ parent: element, children })

        return children
    }

    private async localizeTypeInfoChildren(
        typeInfo: LocalizedTypeInfo,
        typeArguments?: boolean
    ) {
        if (!this.typeInfoResolver?.hasLocalizedTypeInfo(typeInfo)) {
            return []
        }

        return this.typeInfoResolver.localizeChildren(typeInfo, typeArguments)
    }

    private async localizeTypeInfoTypeArguments(typeInfo: LocalizedTypeInfo) {
        return this.localizeTypeInfoChildren(typeInfo, true)
    }

    private async getChildrenWorker(
        element?: TypeTreeItem
    ): Promise<TypeTreeItem[]> {
        if (!element) {
            const typeInfo = this.stateManager.getTypeTree()
            if (!typeInfo) {
                return []
            }

            this.typeInfoResolver = new TypeInfoResolver(getTypeTreeAtLocation)

            const localizedTypeInfo = await this.typeInfoResolver.localize(
                typeInfo
            )

            return [
                this.createTypeNode(localizedTypeInfo, /* root */ undefined),
            ]
        } else {
            const localizedChildren = await this.localizeTypeInfoChildren(
                element.typeInfo
            )

            return localizedChildren
                .map((info) => this.createTypeNode(info, element))
                .filter(
                    ({ typeInfo: { purpose } }) =>
                        showTypeParameterInfo.get() ||
                        !(
                            purpose === "type_argument_list" ||
                            purpose === "type_parameter_list"
                        )
                )
                .filter(
                    ({ typeInfo: { purpose } }) =>
                        showBaseClassInfo.get() ||
                        !(
                            purpose === "class_base_type" ||
                            purpose === "class_implementations" ||
                            purpose === "object_class"
                        )
                )
        }
    }

    createTypeNode(
        typeInfo: LocalizedTypeInfo,
        parent: TypeTreeItem | undefined
    ) {
        return new TypeTreeItem(typeInfo, this, parent)
    }
}

export class TypeTreeItem extends vscode.TreeItem {
    protected depth: number

    constructor(
        public typeInfo: LocalizedTypeInfo,
        private provider: TypeTreeProvider,
        protected parent?: TypeTreeItem
    ) {
        const depth = (parent?.depth ?? 0) + 1

        const { label, description, contextValue, icon, collapsibleState } =
            getMeta(typeInfo, depth)

        super(label, collapsibleState)

        this.depth = depth
        this.description = description
        this.contextValue = contextValue
        this.iconPath = icon
    }

    protected createTypeNode(typeInfo: LocalizedTypeInfo) {
        return this.provider.createTypeNode(typeInfo, this)
    }

    private definitionIndex = 0

    goToDefinition() {
        assert(
            this.typeInfo.locations && this.typeInfo.locations.length > 0,
            "Type has no locations!"
        )

        const location = this.typeInfo.locations[this.definitionIndex]
        this.definitionIndex =
            (this.definitionIndex + 1) % this.typeInfo.locations.length

        const args: [vscode.Uri, vscode.TextDocumentShowOptions] = [
            vscode.Uri.file(location.fileName),
            {
                selection: rangeFromLineAndCharacters(
                    location.range.start,
                    location.range.end
                ),
            },
        ]

        vscode.commands.executeCommand("vscode.open", ...args)
    }
}
