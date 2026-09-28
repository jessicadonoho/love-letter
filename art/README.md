# Card art

Put one image per card in this folder, named by the card's number:

| File | Card |
|---|---|
| `0.png` | Spy |
| `1.png` | Maid |
| `2.png` | Assassin |
| `3.png` | Mercenary |
| `4.png` | Handmaid |
| `5.png` | Viscount |
| `6.png` | Chancellor |
| `7.png` | King |
| `8.png` | Countess |
| `9.png` | Princess |

- `.png`, `.jpg`, `.jpeg`, `.webp`, and `.svg` all work. Each card uses the first one it finds.
- The art shows in a **4:3 box** at the top of the card and is cropped to fit (centered, slightly toward the top). Every card in your hand gets the same box, even cards without art. The number, name, and rule text always show underneath, so don't put the rules in the image itself.
- Keep each file small (around 800×600 and under 200 KB) so it loads fast on phones.
- You can add art for just some cards. Cards without an image keep the text-only look.
- Only use art you have the rights to use (your own, commissioned, or licensed), especially if the site is public.

## Result screens

- `you-won.jpg` shows for the winner at the end of each round and at the end of the game, with confetti.
- `you-lost.jpeg` shows for everyone else.

These are shown whole (not cropped), so any shape works. To use a different file name or type, change `RESULT_ART` in `js/ui.js`.
