// Runtime composition keeps the owned readback view; evidence exports keep JSON arrays.
export function sam3Readback(input, values) {
  if (input.readbackFormat === 'typed-array') return values;
  return Array.from(values);
}

export function sam3TypedView(Type, values) {
  return values instanceof Type ? values : new Type(values);
}
