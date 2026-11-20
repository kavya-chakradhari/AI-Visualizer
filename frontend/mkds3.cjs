const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const id = require('crypto').randomUUID();
  await p.dataset.create({ data: { id, name: 'Undo HTTP Test', rowCount: 10, columnCount: 2,
    schemaJson: JSON.stringify([
      { name:'Sales', dataType:'number', semanticType:'currency', totalCount:10, nullCount:0, nullPercentage:0, uniqueCount:10, cardinalityRatio:1, sampleValues:[] },
      { name:'Region', dataType:'string', semanticType:'categorical', totalCount:10, nullCount:0, nullPercentage:0, uniqueCount:4, cardinalityRatio:0.4, sampleValues:[] }
    ]) } });
  console.log(id);
  await p.$disconnect();
})();
