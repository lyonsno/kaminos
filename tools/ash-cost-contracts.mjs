// Timestamp evidence is admitted only for the exercised route and all requested cases.
export function validateAshCostReport(report){
 if(!report.requested||!report.effective||report.requested.mode!==report.effective.mode||report.requested.width!==report.effective.width)throw Error('Cost configuration differs');
 if(report.status!=='passed'||report.route!=='shared-webgpu-pass-timestamps')throw Error('Incomplete or wrong cost route');
 if(report.sourceBefore!==report.sourceAfter||!report.sourceBefore)throw Error('Source changed during cost witness');
 if(!report.browserClosed||report.errors?.length||report.consoleErrors?.length)throw Error('Unclean cost witness');
 for(const name of ['settled','moving']){
  const rows=report.cases?.[name]?.samples;if(!rows?.length)throw Error('Missing '+name+' samples');
  for(const row of rows)for(const key of ['compute','render']){
   const passes=row[key]?.passes;if(!passes?.length)throw Error('Missing '+key+' passes');
   for(const pass of passes){if(!Array.isArray(pass.timestamps)||pass.timestamps.length!==2||BigInt(pass.timestamps[0])<=0n||BigInt(pass.timestamps[1])<BigInt(pass.timestamps[0]))throw Error('Invalid pass timestamps');}
  }
 }
 return report;
}
