// Stand-in for katex: the Latex feature is disabled in the app, so the
// real library (and its ~1.5MB of fonts) is left out of the bundle.
export default { render() {}, renderToString() { return ''; } };
export const render = () => {};
export const renderToString = () => '';
