
const { connectDatabase } = require('../src/config/db');
const { createApp } = require('../src/app');
const { ensureInitialSeedData } = require('../src/services/authService');

const app = createApp();

let initializationPromise;

async function initialize() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await connectDatabase();

      // تشغيل التهيئة الأولية مرة واحدة لكل بيئة تشغيل
      await ensureInitialSeedData();
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

module.exports = async (req, res) => {
  try {
    await initialize();
    return app(req, res);
  } catch (error) {
    console.error('AMANA initialization error:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Backend initialization failed',
      });
    }
  }
};
