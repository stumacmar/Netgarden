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
- `js/render.js` draws each plant procedurally from those parameters, so a
  single description covers all twelve months. The style is deliberately
  illustrative rather than photo-real.

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
