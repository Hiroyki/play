// Media tidak pernah lewat sini; Java menyambung hulu langsung ke pemutar.
export const Readable = { fromWeb: (body) => body };
export const pipeline = async (body, res) => res.splice(body.handle);
