export async function captureContactPage(session){
 const result=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true});
 const bytes=Buffer.from(result.data??'','base64');
 if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)===0||bytes.readUInt32BE(20)===0)throw Error('Missing or invalid native PNG capture');
 return bytes;
}
