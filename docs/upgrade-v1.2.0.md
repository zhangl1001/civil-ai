# Upgrade to v1.2.0

Civil AI v1.2.0 updates the adaptive daily-plan and generated-content pipeline. It does not intentionally remove local candidate, practice, or conversation data.

## Before upgrading

1. Open **My -> Data management** and export a local backup.
2. Record the configured model provider and model name. API keys are not included in repository files or public release assets.
3. Finish or cancel important in-progress generation and grading tasks.

## Web development upgrade

```bash
git fetch --tags origin
git checkout v1.2.0
npm ci
npm --prefix web ci
npm test
npm --prefix web run dev
```

To use the prebuilt Web bundle, download `civil-ai-web-v1.2.0.zip` from the GitHub Release, extract it, and serve the directory with a static HTTP server. Opening `index.html` directly with `file://` is not supported because browser storage and module loading require an HTTP origin.

Example:

```bash
npx serve civil-ai-web-v1.2.0
```

## iOS installation

The public project does not distribute a development-signed IPA. Development provisioning is tied to an Apple Developer Team and registered devices.

Build with your own signing identity:

```bash
git checkout v1.2.0
npm ci
npm --prefix web ci
npm run ios:sync
open ios/App/App.xcodeproj
```

Then in Xcode:

1. Select the `App` target.
2. Open **Signing & Capabilities**.
3. Select your Apple Developer Team.
4. Change the Bundle Identifier if required.
5. Select a connected iPhone and run the app.

Installing over an older development build normally preserves local data when the Bundle Identifier is unchanged. Deleting the app removes its local container.

## Data compatibility

- Database migrations run during application startup.
- Existing structured learning records remain in place.
- Prompt fixture updates are upserted and do not require deleting the app.
- Recent generated-content outlines are read locally and sent only as a bounded summary when generation needs diversity context.

If startup fails, keep the app installed, capture sanitized logs, and open a Bug Report. Do not post API keys, personal learning data, or full imported examination material.

## Rollback

1. Export a backup before changing versions.
2. Check out `v1.1.1` and rebuild with the same Bundle Identifier.
3. Avoid importing a backup created by a newer schema into an older build unless the backup explicitly declares compatibility.

Report upgrade problems through the repository's [Bug Report](https://github.com/zhangl1001/civil-ai/issues/new?template=bug_report.yml) template.
