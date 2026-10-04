# The web app is one static export, served from GitHub Pages and from the companion

The web app uses no server features (`output: "export"`), so the same build runs in two
places:

- GitHub Pages, which needs no hosting of our own;
- the companion's own loopback origin (`scripts/build-agent-webroot.mjs` bundles it into
  the package).

The companion copy is the recommended way in. There the page and the API share one
origin, so the browser shows no local-network permission prompt, the pairing token can be
handed over without copy and paste, and the token is kept out of the `github.io` origin
that other sites share. As a result, everything the UI shows comes from the companion
over `/v0`, and the build can't rely on API routes, middleware or server rendering.
