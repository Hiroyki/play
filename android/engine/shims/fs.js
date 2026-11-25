const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const need = (v) => {
  if (v === null || v === undefined || v === false) throw missing();
  return v;
};
export const readFile = async (f) => need(Native.read(f));
export const writeFile = async (f, s) => {
  if (!Native.write(f, s)) throw new Error('File tidak bisa ditulis.');
};
export const rename = async (a, b) => void need(Native.rename(a, b));
export const copyFile = async (a, b) => void need(Native.copy(a, b));
export const unlink = async (f) => void need(Native.unlink(f));
export const mkdir = async (d) => void Native.mkdir(d);
export const readdir = async (d) => JSON.parse(need(Native.list(d)));
export const stat = async (f) => {
  const at = Native.mtime(f);
  if (at < 0) throw missing();
  return { mtimeMs: at };
};
