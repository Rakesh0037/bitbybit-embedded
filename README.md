# BitByBit Embedded

Interactive embedded-systems lessons: every lesson starts from a real task and shows
every signal, clock and failure moving on screen.

Plain HTML, CSS and JavaScript. No build step, no frameworks, no external downloads.

```
index.html                    home page, list of lessons
assets/site.css               shared styles (light + dark theme)
lessons/spi-sensor/           "Read a sensor over SPI"
  index.html                  page structure
  lesson.css                  lesson-specific styles
  spi.js                      data, simulation, drawing, code generator
```

## View it locally

Open `index.html` in a browser (double-click it). That's all.

## Put it online (free)

GitHub Pages, from the repository root:

1. Create a public repository on github.com, e.g. `seeembedded`.
2. Push this folder to it.
3. Repository → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
4. The site goes live at `https://<user>.github.io/seeembedded/`. Share that link.

## Rules for content

- Only public material: dev boards, public datasheets and reference manuals, our own code.
- No employer code, schematics, product details or internal documents.
- Every number on a page should come from a datasheet or reference manual. Name the source in the page footer.
