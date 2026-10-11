# Fonts used by server and browser PDFs

Noto Sans is embedded in `booking-font.ts`. Noto Serif Regular, Bold and Italic
are embedded as base64 in the three `NotoSerif-*.ts` modules. They originate from
the matching files in `public/fonts` and use the SIL Open Font License in
`OFL.txt`.

The Serif fonts were subset with fonttools `pyftsubset`:

```
pyftsubset public/fonts/NotoSerif-Regular.ttf \
  --output-file=/tmp/NotoSerif-Regular.ttf \
  --unicodes=U+0000-052F,U+1E00-1EFF,U+2000-206F,U+20AC \
  --no-hinting --layout-features='*'
```

Repeat for Bold and Italic, then base64-encode the resulting font bytes into the
corresponding exported constant. Unhinted fonts are embedded without fontkit's
runtime subsetting: this avoids lost Croatian glyphs in PDF viewers. The shared
renderer needs no font fetch, filesystem access or external font service.
