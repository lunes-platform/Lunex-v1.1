
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const counts = await prisma.$queryRawUnsafe('SELECT "settlementStatus" AS s, count(*)::int AS n FROM "Trade" GROUP BY "settlementStatus" ORDER BY n DESC');
    console.log('STATUS ' + JSON.stringify(counts));
    const cols = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='Trade' ORDER BY ordinal_position`);
    console.log('COLS ' + JSON.stringify(cols.map(c=>c.column_name)));
    const sample = await prisma.$queryRawUnsafe(`SELECT * FROM "Trade" WHERE "settlementStatus"='SKIPPED'::"TradeSettlementStatus" ORDER BY "createdAt" ASC LIMIT 1`);
    console.log('KEYS ' + JSON.stringify(Object.keys(sample[0]||{})));
    console.log('SAMPLE ' + JSON.stringify(sample, (k,v)=> typeof v==='bigint'?v.toString():v).slice(0,1800));
  } catch(e){ console.log('ERR '+e.message); } finally { await prisma.$disconnect(); }
})();
