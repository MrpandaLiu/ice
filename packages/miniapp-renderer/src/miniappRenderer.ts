function miniappRenderer(
  { appConfig = {} as any, createBaseApp, createHistory, staticConfig, pageProps, emitLifeCycles, ErrorBoundary },
  { mount, unmount, createElement, Component }
) {
  const history = createHistory({ routes: staticConfig.routes });

  const { runtime } = createBaseApp(appConfig);
  const AppProvider = runtime?.composeAppProvider?.();

  const { app = {} } = appConfig;
  const { rootId = 'root', ErrorBoundaryFallback, onErrorBoundaryHander, onErrorBoundaryHandler, errorBoundary } = app;

  if (onErrorBoundaryHander) {
    console.error('Please use onErrorBoundaryHandler instead of onErrorBoundaryHander');
  }
  emitLifeCycles();
  class App extends Component {
    public render() {
      const { Page, ...otherProps } = this.props;
      const PageComponent = createElement(Page, {
        ...otherProps
      });

      let appInstance = PageComponent;

      if (AppProvider) {
        appInstance = createElement(AppProvider, null, appInstance);
      }
      if (errorBoundary) {
        appInstance = createElement(ErrorBoundary, {
          Fallback: ErrorBoundaryFallback,
          onError: onErrorBoundaryHander || onErrorBoundaryHandler,
        }, appInstance);
      }
      return appInstance;
    }
  }
  (window as any).__pagesRenderInfo = [];
  (window as any).__render = function(pageComponent) {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('id', rootId);
    const appInstance = mount(createElement(App, {
      history,
      location: history.location,
      ...pageProps,
      Page: pageComponent
    }), rootEl);
    document.body.appendChild(rootEl);

    (document as any).__unmount = unmount(appInstance, rootEl);
  };
}

export default miniappRenderer;
