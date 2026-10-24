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

## The app in four steps

1. **Photo.** Choose a photo, then answer three questions: where your eye
   level is (drag the yellow line), how tall the back fence is (tap the bottom
   and top of one panel; 1.8 m is standard), and which way the camera faces.
   The lens is read from the photo when it carries one. A 1.75 m person stands
   on the lawn and a 1 m grid shows, so you can see the scale is right. Below that, tell it about
   your garden: region, soil, drainage, pH and exposure. These drive the
   "suits my garden" filter and the checks.
2. **Beds.** Draw borders by tapping corners and pressing Done. Paint over
   anything that stands in front of where you will plant, and give it a
   distance, so new plants behind it are hidden by it.
3. **Plants.** Over 400 plants with thumbnails, grouped by role (trees,
   shrubs, climbers, perennials, grasses, bulbs, hedging, ground cover,
   ferns, herbs, vegetables, annuals) and filters such as "suits my garden",
   pollinators, evergreen and winter interest. Tap a plant, then tap the
   lawn, or press and hold a plant card and drag it onto the photo. With
   borders drawn, choosing a plant zooms to the nearest border and planting
   outside one asks first. A bar over the photo lets you flip, duplicate or delete the
   selected plant; fruit trees get a rootstock choice.
4. **Review.** Checks (sun and shade, soil, hardiness, spacing, pollination
   partners), design tips (layering, evergreen backbone, grouping,
   succession), jobs for the month on the slider, the year-round calendar,
   a plan view, a shopping list, export and the realistic render.

On a phone the panel is a sheet that slides up over the photo: swipe its handle
up for the full plant list, down to see the whole photo. Choosing a plant drops
the sheet out of the way; tapping a placed plant brings its details back up.
Done and Cancel for whatever you are doing sit in the strip at the bottom of
the photo. Pinch to zoom, drag with two fingers to pan, and drag the flower
bands to scrub through the year. You can add it to your home screen and it
runs full screen.

The first visit shows a short tour (skippable, and available again from the
⋯ menu). If you would rather start from something, Starter gardens plants a
cottage, wildlife, low-maintenance or edible border along your back fence.

In the plant library, tap **i** on any plant for everything about it:
mature size and rootstocks, spacing, light, flowering and fruiting months,
pollination partners, the jobs it needs through the year, and why it does or
does not suit your garden. Tap **☆** to add it to your shortlist, and use the
Shortlist filter to see just those. Filters stay on between visits.

Select a placed plant to Flip, Duplicate, Replace it with another plant in the
same spot, or Delete it. To work on several at once, Shift-click them (or tap
**+** in the selection bar on a phone and then tap more plants): drag one to
move them all, Line up spaces them evenly, and Delete or Duplicate act on the
whole group.

**Care calendar.** Review opens with a year of jobs for the plants in your
design: what to prune, trim, cut back, deadhead, feed, mulch, water, stake,
divide, sow, plant out, pick and protect, and when, each with a short reason.
This month's jobs come first, with tick boxes that are remembered, and the
Review step shows how many are still to do. Timings are for southern
England; frost-tied jobs (planting out tender plants, taking off winter
protection) move a month later in the north and Scotland, and a newly
planted garden gets extra watering for its first two summers. Hand-written
jobs in the plant library always win; the rest are worked out from what the
library knows about each plant (type, flowering and fruiting months,
evergreen or not, hardiness, soil). Add to my calendar saves an iCalendar
file with a yearly reminder on the first Saturday of each month, and Print
care calendar prints the whole year. Each plant's own care is also in its
details (the **i** button). It is also in the ⋯ menu.

In Review, Print planting list gives a sheet with the picture, quantities,
mature sizes, spacing and care, and Save the year as an animation makes a
looping GIF of the garden through the seasons.

Undo and Redo are always in the top bar (also Ctrl+Z and Ctrl+Shift+Z).
Zoom with the buttons, the mouse wheel or a pinch, and drag the photo to
pan, to place small plants precisely. Plants cannot leave the photo.
The coloured bands under the time slider show when each of your plants is
in flower; the gaps are the quiet months.

## How to use it (details)

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

## Making plants sit in the photo

Every plant, drawn or photographed, gets the same treatment so it reads as
part of the picture rather than a sticker on it:

- a **cast shadow** on the lawn along the sun direction you set in Setup
  (match an existing shadow in your photo), plus a soft contact shadow;
- **exposure and warmth matched** to the photo automatically, with sliders
  to fine-tune;
- **distance haze**: far plants are slightly softer and less saturated;
- **grain and a feathered edge** so cutouts are not unnaturally clean;
- **flip**: mirror a plant so its lit side faces the sun (generated photos
  are lit from the left and flip automatically when the sun is on the right).

**Things in front.** Use "Mark foreground" to paint over anything that
stands in front of where you will plant: your existing shrub, the stone
edge, a wall. Give each a distance by clicking the ground where it stands.
Plants behind it are hidden by it; plants in front are not.

**Borders** have a surface: bare soil, bark mulch or gravel, mapped through
the perspective.

**Garden age.** The slider in the Design tab shows the garden at one to
fifteen years after planting. Trees take about ten years to reach the
library's mature size, shrubs five, perennials two.

**Checks.** Tell Setup which way the camera faces and the app flags
sun-lovers in shade (the border in front of a south-facing fence, or under a
tree) and shade plants in full sun, and warns when two plants are closer
than their mature spreads allow. Pick your region to shift flowering by
up to three weeks. These checks are rough guides, not horticulture.

**Shopping list.** The Design tab totals what you have placed with a
suggested pot size and a link to the RHS entry. Undo is Ctrl+Z.

## Realistic render

"Render this month" in Setup sends the current view to an image model that
re-renders the planted areas so they look photographed in place, keeping
the rest of your photo untouched. It needs your own OpenAI API key (it stays
in your browser; each render costs a few pence). The slider stays live for
planning; the render is the picture you would show someone.

## Photo-real plants

Plants are drawn from real photographs when a cutout exists for them, with a
crossfade between seasonal states as the slider moves. Each plant can have up
to six states: `leaf`, `flower`, `fruit`, `autumn`, `spring`, `bare`. A state
without a photo borrows the nearest one; a missing `bare` state draws the
winter branch structure instead. Plants with no photos at all fall back to the
drawn style.

The bundled library was made on an ordinary CPU with no API key:
`tools/render_inits.js` draws every plant with the app's own renderer, and
`tools/gen_local.py` refines each drawing with a small local image-to-image
diffusion model (sd-turbo), which keeps the whole-plant composition and
adds photographic texture, then keys out the white background. About 25
seconds an image. Re-run it after adding plants to the library.

There are three other ways to get photos in:

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
  between seasonal states). Otherwise it draws the plant from individual
  leaves and flowers: every species has a leaf shape (oval, lanceolate,
  lobed, pinnate, needle, strap, frond, round, palm) and a flower form
  (daisy, spike, umbel, ball, bell, rose, cup, trumpet, blossom, raceme,
  catkin, plume), inferred from its botanical name or set explicitly with
  `leafShape` and `flowerForm` in the library.
- `js/compose.js` caches each rendered plant so the slider stays smooth.
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
