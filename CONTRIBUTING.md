# Contributing to NexusMods Bypass

Bug reports and focused pull requests are welcome. Before contributing, read the source-available [licence](LICENSE); contributions are licensed to the project owner under its terms.

## Reporting a bug

Use the [guided issue form](https://github.com/thomasthanos/nexusmods-bypass/issues/new/choose) and include:

- extension version
- browser and browser version
- collection or download mode involved
- what you expected
- what happened instead
- the generated error report, when available

Do not include Nexus credentials, cookies, tokens, or private URLs.

## Sending a pull request

1. Fork the repository and create a focused branch.
2. Make the smallest change that solves the problem.
3. Load `src/` as an unpacked extension and exercise the affected flow. In Firefox, load the built
   `dist/nexus.mods.bypass-<version>-firefox.zip` instead — `src/manifest.json` declares a
   `background.service_worker`, which Firefox does not accept; the Firefox manifest is generated
   by `tools/build-zip.mjs`.
4. Run the locale validator when strings change:

   ```bash
   node tools/check-locales.mjs
   ```

5. Run the package builder before submitting:

   ```bash
   node tools/build-zip.mjs
   ```

6. Explain what changed and how it was tested.

Keep permissions narrow, do not add remote code or telemetry, and do not commit generated archives from `dist/`.

## Scope

Good contributions include bug fixes, compatibility updates, translation corrections, accessibility improvements, and narrowly justified features. Changes that weaken privacy, broaden host access without need, hide behaviour, or add analytics will not be accepted.
