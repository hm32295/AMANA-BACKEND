const mongoose = require('mongoose');

async function withMongoTransaction(workFn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await workFn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withMongoTransaction };
