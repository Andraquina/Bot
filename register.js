const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🧹 Clearing GLOBAL commands...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] } // 🔥 THIS CLEARS GLOBAL COMMANDS
    );

    console.log('✅ Global commands cleared!');
  } catch (error) {
    console.error(error);
  }
})();
