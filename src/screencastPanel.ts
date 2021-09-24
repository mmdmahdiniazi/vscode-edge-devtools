// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as path from 'path';
import * as vscode from 'vscode';
import { encodeMessageForChannel, WebSocketEvent } from './common/webviewEvents';
import TelemetryReporter from 'vscode-extension-telemetry';
import { ErrorReporter } from './errorReporter';
import { PanelSocket } from './panelSocket';
import { ScreencastView } from './screencast/view';
import {
    SETTINGS_STORE_NAME,
    SETTINGS_SCREENCAST_WEBVIEW_NAME,
    createTelemetryReporter,
} from './utils';

export class ScreencastPanel {
    private static instance: ScreencastPanel | undefined;
    private readonly context: vscode.ExtensionContext;
    private readonly extensionPath: string;
    private readonly panel: vscode.WebviewPanel;
    private targetUrl: string
    private panelSocket: PanelSocket;
    private telemetryReporter: Readonly<TelemetryReporter>;

    private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        targetUrl: string) {
        this.panel = panel;
        this.context = context;
        this.targetUrl = targetUrl;
        this.extensionPath = this.context.extensionPath;
        this.telemetryReporter = createTelemetryReporter(context);

        this.panelSocket = new PanelSocket(this.targetUrl, (e, msg) => this.postToWebview(e, msg));
        this.panelSocket.on('close', () => this.onSocketClose());
        this.panelSocket.on('reportError', msg => this.reportError(msg));

        // Handle closing
        this.panel.onDidDispose(() => {
            this.dispose();
            this.panelSocket.dispose();
        }, this);

        // Handle view change
        this.panel.onDidChangeViewState(_e => {
            if (this.panel.visible) {
                this.update();
            }
        }, this);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(message => {
            this.panelSocket.onMessageFromWebview(message);
        }, this);
    }

    dispose(): void {
        ScreencastPanel.instance = undefined;

        this.panel.dispose();
        this.panelSocket.dispose();
    }

    private onSocketClose() {
        this.dispose();
    }

    private update() {
        this.panel.webview.html = this.getHtmlForWebview();
    }

    private postToWebview(e: WebSocketEvent, message?: string) {
        encodeMessageForChannel(msg => this.panel.webview.postMessage(msg) as unknown as void, 'websocket', { event: e, message });
    }

    private reportError(msg: string) {
        const errorObj = JSON.parse(msg);
        if (errorObj.errorCode !== undefined && errorObj.title && errorObj.message) {
            ErrorReporter.showErrorDialog(errorObj);
        } else {
            this.telemetryReporter.sendTelemetryErrorEvent('view/screencast/error', { message: msg });
        }
    }

    private getHtmlForWebview() {
        const inspectorPath = vscode.Uri.file(path.join(this.extensionPath, 'out/screencast', 'screencast.bundle.js'));
        const inspectorUri = this.panel.webview.asWebviewUri(inspectorPath);
		const codiconsUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        const cssPath = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out/screencast', 'view.css'));
        const view = new ScreencastView(this.panel.webview.cspSource, cssPath, codiconsUri, inspectorUri);
        return view.render();
    }

    static createOrShow(context: vscode.ExtensionContext,
        targetUrl: string): void {
        const column = vscode.ViewColumn.Beside;
        if (ScreencastPanel.instance) {
            ScreencastPanel.instance.dispose();
        } else {
            const panel = vscode.window.createWebviewPanel(SETTINGS_STORE_NAME, SETTINGS_SCREENCAST_WEBVIEW_NAME, column, {
                enableCommandUris: true,
                enableScripts: true,
                retainContextWhenHidden: true,
            });
            ScreencastPanel.instance = new ScreencastPanel(panel, context, targetUrl);
        }
    }
}