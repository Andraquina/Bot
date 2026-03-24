// =========================
// IMPORTS
// =========================
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

const session = new Map();
const guildMemberCache = new Map();

// =========================
// READY
// =========================
client.once(Events.ClientReady, async () => {
  console.log('BOT IS ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
});

// =========================
// DM AUTO RESPONSE
// =========================
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  if (!message.guild) {
    return message.reply(
      "📩 This bot does not reply to direct messages.\nPlease contact us through official server channels."
    );
  }
});

// =========================
// HELPERS (UNCHANGED)
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function extractKeywords(str) {
  return str.toLowerCase().split(/\s+/);
}
function formatWords(str) {
  return str.toLowerCase().split(/\s+/)
    .filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
function getAcronym(company) {
  const words = company.toLowerCase().split(/\s+/);
  if (words.length === 1) return company;
  return words.map(w => w[0].toUpperCase()).join('');
}
function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const acA = getAcronym(a).toLowerCase();
  const acB = getAcronym(b).toLowerCase();
  if (acA === nb || acB === na) return true;

  const wordsA = extractKeywords(a);
  const wordsB = extractKeywords(b);
  const common = wordsA.filter(w => wordsB.includes(w));
  return common.length >= Math.min(wordsA.length, wordsB.length) / 2;
}
function safeCompanyId(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

// =========================
// JOIN SYSTEM
// =========================
client.on(Events.GuildMemberAdd, async member => {

  const channel = member.guild.channels.cache.find(c => c.name === "welcome");
  if (!channel) return;

  const button = new ButtonBuilder()
    .setCustomId('open_form')
    .setLabel('Start Setup')
    .setStyle(ButtonStyle.Primary);

  await channel.send({
    content: `<@${member.id}> Welcome! Click below to get started:`,
    components: [new ActionRowBuilder().addComponents(button)]
  });
});

// =========================
// BROADCAST HELPERS
// =========================
async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();

  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name)
    .slice(0, 25);

  return new StringSelectMenuBuilder()
    .setCustomId("select_companies")
    .setPlaceholder("Select companies")
    .setMinValues(1)
    .setMaxValues(Math.min(roles.length + 1, 25))
    .addOptions([
      { label: "ALL", value: "all" },
      ...roles.map(r => ({ label: r, value: r }))
    ]);
}

// =========================
// INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // OPEN FORM
    // =========================
    if (interaction.isButton() && interaction.customId === 'open_form') {
      try { await interaction.message.delete(); } catch {}

      const modal = new ModalBuilder()
        .setCustomId('user_form')
        .setTitle('Enter your info');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('Your Name').setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('company').setLabel('Your Company').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // =========================
    // USER FORM
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === 'user_form') {
      await interaction.deferReply({ ephemeral: true });

      let name = formatWords(interaction.fields.getTextInputValue('name'));
      let company = formatWords(interaction.fields.getTextInputValue('company'));

      const member = await interaction.guild.members.fetch(interaction.user.id);

      const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
      if (pendingRole) await member.roles.add(pendingRole);

      const approveBtn = new ButtonBuilder()
        .setCustomId(`approve_${member.id}_${safeCompanyId(company)}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success);

      const adminChannel = interaction.guild.channels.cache.find(c => c.name === "admin");

      if (adminChannel) {
        await adminChannel.send({
          content: `User: <@${member.id}>\nCompany: ${company}`,
          components: [new ActionRowBuilder().addComponents(approveBtn)]
        });
      }

      return interaction.editReply({ content: `Pending approval...` });
    }

    // =========================
    // APPROVE
    // =========================
    if (interaction.isButton() && interaction.customId.startsWith("approve_")) {

      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.customId.split('_')[1];
      const member = await interaction.guild.members.fetch(userId);

      await member.send(`✅ Approved! Welcome 🎉`);

      await member.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Rules")
            .setDescription("• Be respectful\n• No spam\n• Follow ToS")
        ]
      });

      await interaction.message.delete().catch(() => {});

      return interaction.editReply({ content: "Approved" });
    }

    // =========================
    // SETUP BROADCAST PANEL
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {

      const button = new ButtonBuilder()
        .setCustomId("start_broadcast")
        .setLabel("📢 Start Broadcast")
        .setStyle(ButtonStyle.Primary);

      await interaction.channel.send({
        content: "📢 Broadcast Panel",
        components: [new ActionRowBuilder().addComponents(button)]
      });

      return interaction.reply({ content: "Panel created", ephemeral: true });
    }

    // =========================
    // START BROADCAST
    // =========================
    if (interaction.isButton() && interaction.customId === "start_broadcast") {

      const dropdown = await buildDropdown(interaction.guild);

      const msg = await interaction.reply({
        content: "Select companies:",
        components: [new ActionRowBuilder().addComponents(dropdown)]
      });

      session.set(interaction.user.id, { message: msg });
      return;
    }

    // =========================
    // DROPDOWN
    // =========================
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {

      session.set(interaction.user.id, {
        ...session.get(interaction.user.id),
        targets: interaction.values
      });

      const modal = new ModalBuilder()
        .setCustomId("broadcast_modal")
        .setTitle("Broadcast Message");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Message")
            .setStyle(TextInputStyle.Paragraph)
        )
      );

      return interaction.showModal(modal);
    }

    // =========================
    // MODAL → PREVIEW
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {

      await interaction.deferUpdate();

      const data = session.get(interaction.user.id);
      const messageContent = interaction.fields.getTextInputValue("message");

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      await data.message.edit({
        content: `Preview:\n\n${messageContent}`,
        components: [buttons]
      });

      session.set(interaction.user.id, {
        ...data,
        messageContent
      });
    }

    // =========================
    // CONFIRM SEND
    // =========================
    if (interaction.isButton() && interaction.customId === "confirm") {

      const data = session.get(interaction.user.id);

      await interaction.update({ content: "Sending...", components: [] });

      const members = await interaction.guild.members.fetch();

      let i = 0;

      for (const member of members.values()) {
        if (member.user.bot) continue;

        i++;
        try { await member.send(data.messageContent); } catch {}
      }

      await interaction.editReply({ content: "✅ Done" });

      session.delete(interaction.user.id);
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
