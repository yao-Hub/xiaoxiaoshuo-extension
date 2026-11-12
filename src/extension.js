const vscode = require('vscode');
const { scheduleExtensionAnalytics } = require('./analytics');
const { NovelReaderSidebarProvider, VIEW_ID } = require('./sidebar/provider');

let sidebarProvider;

function activate(context) {
  scheduleExtensionAnalytics(context);
  sidebarProvider = new NovelReaderSidebarProvider(
    context.extensionUri,
    context.globalState,
    context,
    context.globalStorageUri
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.commands.registerCommand('xiaoxiaoshuo.open', async () => {
      await sidebarProvider.openPrompt();
    })
  );
}

function deactivate() {
  sidebarProvider?.dispose();
  sidebarProvider = undefined;
}

module.exports = {
  activate,
  deactivate
};
