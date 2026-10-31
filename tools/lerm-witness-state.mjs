export async function waitForLermState(read, predicate, next=()=>new Promise(resolve=>setTimeout(resolve,100))) {
  while (true) {
    const state=await read();
    if (await predicate(state)) return state;
    await next();
  }
}
