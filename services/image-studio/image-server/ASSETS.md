# Media Hub asset gallery

Preview gallery: http://meesa.local:3002/assets/

Use hostname-based share links from the page's **Copy share link** button. Preview data lives in `~/.agent-tools/image-studio/assets`; it is independent from the original on port 3001. The original publishing directories and launchers are unchanged. The remaining notes below document the historical source implementation.

The PC and phone must be on the same home network, and the PC must be running.
Image Studio's home page links to the asset library at `/assets/`. Its existing
server serves curated copies from `image-server/assets/` on the same port as
image generation. The asset route exposes only the selected gallery files.

Start Image Studio with `Start Image Server.cmd`, or run
`node image-server/server.mjs` with `IMAGE_HOST=0.0.0.0` and `IMAGE_PORT=3001`.
No additional listener or firewall port is needed.

Run the integration checks with
`node --test image-server/assets.test.mjs image-server/server.test.mjs`.
These exercise the asset route through the existing Image Studio server.

## Connecting an existing Image Studio

The existing Image Studio application is untracked local work in this repository.
Its local integration is already applied. To recreate the navigation link on a
separate installation, add this beside its other home-page links:

```html
<a id="assetLibraryLink" href="/assets/">Asset library</a>
```

To serve the collection from the main server, import `serveAsset`
from `./assets.mjs`, set `assetDir` to `path.join(here, 'assets')`, and add this
after its GET-method validation and before its other page routes:

```js
if (await serveAsset(url.pathname, res, assetDir)) return;
```

Restart Image Studio after changing its JavaScript server code. Changes to
gallery HTML or files are picked up immediately.

## Publishing assets

The Moh Harang collection contains 12 copied files from the RPG project:
the GLB, Blender review, four Blender renders, gameplay screenshot, portrait,
turnaround, and three reference crops. This is a static pipeline test whose
design is not approved. No rig or animations are included.

To publish another collection, add a lowercase, hyphenated directory under
`assets/` with `index.html` and selected PNG, JPEG, WebP, GLB, or BLEND files.
Add its link to `assets/index.html`. Do not copy credentials or private metadata.
HTML and files are read on request, so gallery updates need no restart.
