type ColorFn = (s: string) => string;

const color =
  (code: number): ColorFn =>
  (s) =>
    `\x1b[${code}m${s}\x1b[39m`;

export const red = color(31);
export const green = color(32);
export const yellow = color(33);
export const blue = color(34);
export const magenta = color(35);
export const cyan = color(36);
export const greenBright = color(92);
export const yellowBright = color(93);
export const blueBright = color(94);
export const magentaBright = color(95);
export const cyanBright = color(96);

export const httpStatusColor = (status: number): ColorFn => {
  if (status <= 399) {
    return green;
  }
  if (status <= 499) {
    return red;
  }
  return red;
};

const SERVICE_COLORS: ColorFn[] = [
  green,
  magenta,
  blue,
  greenBright,
  yellowBright,
  blueBright,
  magentaBright,
  cyanBright,
];

export const serviceColor = (name: string): ColorFn => {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  return SERVICE_COLORS[Math.abs(hash) % SERVICE_COLORS.length];
};
