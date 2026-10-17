# Netgarden

A garden planner that works on a photo of your own garden, with a time slider
that runs through the year so you can see what is in leaf, in flower, fruiting
or bare in any month, and how the plants you choose look together.

Everything runs in the browser. There is no server, no account and no build
step. Your photo and design never leave your machine (they are saved in the
browser's local storage).

## Run it

Open `index.html` in a modern browser. That is enough for everything except
"Save picture" on the bundled sample photo, which browsers block from a file
URL. For that, serve the folder instead:

```
python3 -m http.server 8000
```

and open http://localhost:8000/.

## How to use it

1. **Set up photo.** Upload a photo taken from where you usually look at the
   garden. Drag the yellow horizon line to your eye level (for a 1.8 m fence,
   a little below its top), then mark one length you know, such as the back
   fence, and type its length in metres. The readout shows the camera height
   the app has inferred; around 1.3 to 1.6 m for a phone at chest height means
   the calibration is good. The bundled sample photo comes pre-calibrated.
2. **Draw border.** Click the corners of a bed on the lawn, then double-click
   or press Enter to finish.
3. **Plants.** Pick a plant on the right and click where it should go. Plants
   scale with distance, so a shrub near the back fence looks smaller than the
   same shrub near the patio. Drag plants to move them, Delete to remove them.
   Escape clears the chosen plant. Select a placed plant to change its size
   (young plant vs mature) or duplicate it.
4. **Time slider.** Drag across the year, press play, or use the arrow keys.
5. **Calendar tab.** A month-by-month chart of every plant you have placed:
   foliage colour, flowering months and fruiting months, plus what is in
   flower right now and which months have no flowers at all.
6. **Design tab.** A top-down plan in metres, and the list of everything
   planted.

Designs save automatically. Export them as a JSON file to move between
browsers, and "Save picture" writes the current view as a JPEG.

## Photo-real plants

Plants are drawn from real photographs when a cutout exists for them, with a
crossfade between seasonal states as the slider moves. Each plant can have up
to six states: `leaf`, `flower`, `fruit`, `autumn`, `spring`, `bare`. A state
without a photo borrows the nearest one; a missing `bare` state draws the
winter branch structure instead. Plants with no photos at all fall back to the
drawn style.

There are three ways to get photos in:

1. **Your own photos, in the app.** Photograph a plant at a garden centre
   against something plain. Lift the subject so the background is transparent
   (on an iPhone, long-press the plant in Photos and share it as an image;
   Android and most photo apps have an equivalent, and remove.bg works too).
   Select a placed plant in the Design tab, open "Photos of this plant", pick
   the season and add the PNG. It is stored in your browser.

2. **Generate the whole library.** The OpenAI image API can return plants on a
   transparent background directly. With a key:

   ```
   export OPENAI_API_KEY=...
   python3 tools/sprites.py generate-all --quality medium
   ```

   That is 273 images for every plant and state (see `tools/sprites.py
   prompts` for the exact prompts). Use `--limit 10` to try a few first, or
   `--only lavender-hidcote,apple-discovery` for specific plants. Generated
   images land in `assets/sprites/` with a manifest the app reads on load.

3. **Wikimedia Commons.** `tools/sprites.py search <plant-id>` builds a
   contact sheet of reusable (CC BY, CC BY-SA, CC0, public domain) photos,
   `fetch` downloads one with its credit, and `cutout` removes the background
   with either u2net or RMBG-1.4. Be warned: this only works for plants
   photographed against sky or a plain wall. Plants in a garden setting do
   not separate cleanly, which is why the bundled set is small. Credits for
   Commons photos are shown in the Setup tab, as their licences require.

Background removal needs `pip install rembg onnxruntime pillow numpy`.

## How it works

- `js/homography.js` and the camera model in `js/app.js` put a flat ground
  plane under the photo. One horizon line plus one known length is enough to
  recover the camera's tilt and height, which gives true metres anywhere on
  the lawn.
- `js/plants.js` is the plant library: about 95 UK garden plants with mature
  size, evergreen or deciduous, sun needs, foliage and autumn colour,
  flowering months and colour, fruit months and colour, and winter stem colour.
- `js/phenology.js` derives a visual state for any point in the year and
  interpolates between months so the slider moves smoothly.
- `js/render.js` draws photo sprites when a plant has them (crossfading
  between seasonal states) and otherwise draws the plant procedurally from
  its parameters.
- `tools/sprites.py` builds the photo library: Commons search and fetch,
  background removal, image generation, and the manifest.

## Adding plants

Add a record to `js/plants.js`. Months are 1 to 12, sizes are metres:

```js
add({ id: 'my-plant', name: 'Common name', latin: 'Genus species', type: 'shrub',
      h: 1.5, s: 1.2, sun: 'full', ev: false,
      leaf: '#4a7a3f', autumn: '#c9a23a',
      flower: { c: '#d9478a', m: [6, 7, 8] },
      fruit: { c: '#d8343a', m: [9, 10] },
      notes: 'Anything useful.' });
```
