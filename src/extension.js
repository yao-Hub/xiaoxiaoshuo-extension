const vscode = require('vscode');
const { startExtensionAnalytics } = require('./analytics');
const { NovelReaderSidebarProvider, VIEW_ID } = require('./sidebar/provider');

let sidebarProvider;

function activate(context) {
  void startExtensionAnalytics(context);
  sidebarProvider = new NovelReaderSidebarProvider(context.extensionUri, context.globalState);

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
  sidebarProvider = undefined;
}

module.exports = {
  activate,
  deactivate
};
