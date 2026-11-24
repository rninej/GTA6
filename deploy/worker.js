// Static host for the Palma City browser build.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
