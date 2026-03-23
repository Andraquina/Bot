const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// ✅ DEFINE COMMAND
const commands = [
  new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Send a broadcast message')
    .addStringOption(option =>
      option.setName('targets')
        .setDescription('Select company or type')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message to send')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('delay')
        .setDescription('Optional delay (10m, 1h, etc)')
        .setRequired(false)
    )
].map(cmd => cmd.toJSON());

// ✅ GET ENV VARIABLES FROM RAILWAY
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ✅ REGISTER COMMAND
(async () => {
  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log('Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
