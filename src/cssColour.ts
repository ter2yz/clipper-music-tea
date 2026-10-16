/**
 * Whether `value` is a CSS colour the Tracklist template can use as `color:`. Checked without
 * a browser so validation stays cheap: hex forms and named colours exactly; colour functions
 * (rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch()) as 3–4 numeric arguments, so obvious
 * typos are caught but per-function ranges are not. `color()` and relative colours aren't accepted.
 */
export function isCssColour(value: string): boolean {
  const v = value.trim().toLowerCase();
  return HEX.test(v) || FUNCTION.test(v) || NAMED_COLOURS.has(v);
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const NUMBER = String.raw`(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:%|deg|rad|grad|turn)?|none)`;
const FUNCTION = new RegExp(String.raw`^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*${NUMBER}(?:\s*[,/]?\s*${NUMBER}){2,3}\s*\)$`);

// CSS Color Module Level 4 named colours, plus `transparent`.
const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent"
  ).split(" "),
);
