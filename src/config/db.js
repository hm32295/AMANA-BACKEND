const mongoose = require('mongoose');
const { getEnvConfig } = require('./env');

let memoryReplSet = null;

async function connectDatabase(overrideUri) {
  const cfg = getEnvConfig();
  let uri = overrideUri || cfg.mongodbUri;

  if ((!uri || cfg.useInMemoryMongo) && !cfg.isProduction) {
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    if (!memoryReplSet) {
      memoryReplSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
    }
    uri = memoryReplSet.getUri('amana');
  }

  if (!uri) {
    throw new Error('MONGODB_URI is required to start the AMANA backend.');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000,
  });

  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryReplSet) {
    await memoryReplSet.stop();
    memoryReplSet = null;
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
};
