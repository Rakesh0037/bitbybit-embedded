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
lessons/memory-robots/        "Where do your variables live?"
lessons/cpu-waiting/          "Your CPU is fast. So why is it waiting?"
lessons/uart-zoom/            "UART at 100× zoom" (register-level DMA send)
lessons/task-home/            "A task's home in memory" (FreeRTOS task: heap, stack, TCB)
```

Story lessons (memory-robots, cpu-waiting, task-home) share one step engine: every step
changes the scene state, Next animates, Back jumps. In cpu-waiting:

- `?step=12` opens a given step (good for sharing one moment).
- `?video` shows only the scene and the popup, for screen recording.
  `?video&ch=7&end=7&speed=slow` limits auto-play to chapter 7.
- Arrow keys or space step through the story.

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
