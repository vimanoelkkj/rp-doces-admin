# Offline audit fonts

These variable TrueType fonts are test fixtures, not production assets. They reproduce the Home's Fraunces and Manrope typography without external connections. The accompanying OFL files contain the full SIL Open Font License and copyright notices. Do not delete them when distributing the fixtures.

Downloaded from the official Google Fonts repository on 2026-10-09:

- `fraunces.ttf`: https://github.com/google/fonts/blob/4024282d9b0cffcdb8e3024560862746178d741f/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf
- `fraunces-italic.ttf`: https://github.com/google/fonts/blob/4024282d9b0cffcdb8e3024560862746178d741f/ofl/fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf
- `fraunces-OFL.txt`: https://github.com/google/fonts/blob/4024282d9b0cffcdb8e3024560862746178d741f/ofl/fraunces/OFL.txt
- `manrope.ttf`: https://github.com/google/fonts/blob/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope/Manrope%5Bwght%5D.ttf
- `manrope-OFL.txt`: https://github.com/google/fonts/blob/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope/OFL.txt

The exact binary files are checked in (about 940 KB combined). The audit records their SHA-256 hashes in every reproduction attachment; execution does not download or update them. The Home does not use Inter, so that family is not bundled. Review the fixture version and screenshots when intentionally updating these fonts.

The three binaries were verified byte-for-byte against these pinned sources. The license text is preserved; one trailing space per license was removed to pass `git diff --check`. Fraunces exposes `opsz` 9–144, `wght` 100–900, `SOFT` 0–100 (default 0) and `WONK` 0–1 (default 1); Manrope exposes `wght` 200–800. Audit CSS declares those weight ranges. The Home uses Manrope 400–700 and Fraunces 600/700 plus italic 600, with default optical sizing. All three faces must actually load before capture.

These complete TTFs reproduce the requested families/styles/axes, but are not the browser-specific WOFF2 subsets returned by Google's live stylesheet. The live service may update independently; pixel parity with an unspecified future Google Fonts response is not guaranteed.
