export default async function observe({retain}) {
  const result = await retain({name:'scene'});
  return {filename:result.filename,url:result.url};
}
