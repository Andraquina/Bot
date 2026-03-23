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
  EmbedBuilder,
  Partials
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, () => {
  console.log('BOT IS ONLINE');
});


// =========================
// 🧠 HELPERS
// =========================

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatWords(str) {
  return str
    .toLowerCase()
    .split(/\s+/)
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

  return false;
}

const selections = new Map(); // 🔥 NEW


// =========================
// 📩 DM AUTO RESPONSE
// =========================

const repliedUsers = new Set();

client.on(Events.MessageCreate, async (message) => {

  if (message.author.bot) return;

  if (!message.guild) {

    if (repliedUsers.has(message.author.id)) return;

    await message.reply(
      "📩 **Inter Molds System**\n\n" +
      "This bot is used for notifications only.\n" +
      "We do not receive or monitor messages sent here.\n\n" +
      "If you need assistance, please contact us through our official channels."
    );

    repliedUsers.add(message.author.id);
    return;
  }
});


// =========================
// 👋 ON USER JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {

  const channel = member.guild.channels.cache.find(c => c.name === "welcome");
  if (!channel) return;

  const button = new ButtonBuilder()
    .setCustomId('open_form')
    .setLabel('Start Setup')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    content: `<@${member.id}> Welcome! Click below to get started:`,
    components: [row]
  });
});


// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // 🚀 ULTIMATE UI BROADCAST
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === 'broadcast') {

      await interaction.deferReply();

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({ content: "❌ Not allowed." });
      }

      const roles = interaction.guild.roles.cache
        .filter(r => r.name !== "@everyone")
        .map(r => r.name)
        .slice(0, 6);

      const buttons = roles.map(name =>
        new ButtonBuilder()
          .setCustomId(`select_${name}`)
          .setLabel(name)
          .setStyle(ButtonStyle.Secondary)
      );

      buttons.push(
        new ButtonBuilder()
          .setCustomId("select_all")
          .setLabel("ALL")
          .setStyle(ButtonStyle.Primary)
      );

      const confirm = new ButtonBuilder()
        .setCustomId("confirm_selection")
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success);

      const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
      const row2 = new ActionRowBuilder().addComponents(buttons.slice(5), confirm);

      selections.set(interaction.user.id, []);

      await interaction.editReply({
        content: "🎯 **Select target companies:**",
        components: [row1, row2]
      });

      return;
    }

    // =========================
    // 🎯 BUTTON HANDLER
    // =========================
    if (interaction.isButton()) {

      const userId = interaction.user.id;

      if (!selections.has(userId)) return;

      let selected = selections.get(userId);

      if (interaction.customId.startsWith("select_")) {

        const company = interaction.customId.replace("select_", "");

        if (company === "all") {
          selected = ["all"];
        } else {
          if (selected.includes(company)) {
            selected = selected.filter(c => c !== company);
          } else {
            selected.push(company);
          }
        }

        selections.set(userId, selected);

        return interaction.update({
          content: `🎯 Selected: ${selected.join(", ") || "None"}`,
          components: interaction.message.components
        });
      }

      if (interaction.customId === "confirm_selection") {

        const targets = selections.get(userId);
        selections.delete(userId);

        if (!targets || targets.length === 0) {
          return interaction.update({
            content: "❌ No selection made.",
            components: []
          });
        }

        await interaction.update({
          content: `🚀 Sending to: ${targets.join(", ")}`,
          components: []
        });

        const members = await interaction.guild.members.fetch();

        let success = 0;

        for (const member of members.values()) {

          if (member.user.bot) continue;

          if (
            targets.includes("all") ||
            member.roles.cache.some(role =>
              targets.some(t => isSameCompany(role.name, t))
            )
          ) {
            try {
              await member.send("📢 **New Company Announcement**");
              success++;
            } catch {}
          }
        }

        await interaction.followUp({
          content: `✅ Sent to ${success} users`
        });
      }
    }

    // =========================
    // 🧾 EXISTING SYSTEM
    // =========================
    if (interaction.isButton() && interaction.customId === 'open_form') {

      try { await interaction.message.delete(); } catch {}

      const modal = new ModalBuilder()
        .setCustomId('user_form')
        .setTitle('Enter your info');

      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Your Name')
        .setStyle(TextInputStyle.Short);

      const companyInput = new TextInputBuilder()
        .setCustomId('company')
        .setLabel('Your Company')
        .setStyle(TextInputStyle.Short);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(companyInput)
      );

      await interaction.showModal(modal);
      return;
    }

  } catch (error) {
    console.error("ERROR:", error);
  }
});

client.login(process.env.TOKEN);
