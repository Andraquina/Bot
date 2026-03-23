const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  PermissionsBitField,
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

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

// store selections
const userSelections = new Map();

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // 🚀 START BROADCAST
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === 'broadcast') {

      await interaction.deferReply({ ephemeral: true });

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply("❌ Not allowed.");
      }

      const roles = interaction.guild.roles.cache
        .filter(r => r.name !== "@everyone")
        .map(r => r.name)
        .slice(0, 25);

      const select = new StringSelectMenuBuilder()
        .setCustomId("company_select")
        .setPlaceholder("Select companies...")
        .setMinValues(1)
        .setMaxValues(Math.min(roles.length, 25))
        .addOptions([
          { label: "ALL", value: "all" },
          ...roles.map(r => ({ label: r, value: r }))
        ]);

      const row = new ActionRowBuilder().addComponents(select);

      await interaction.editReply({
        content: "🎯 Select companies:",
        components: [row]
      });

      return;
    }

    // =========================
    // 📌 DROPDOWN SELECT
    // =========================
    if (interaction.isStringSelectMenu() && interaction.customId === "company_select") {

      userSelections.set(interaction.user.id, interaction.values);

      const modal = new ModalBuilder()
        .setCustomId("broadcast_modal")
        .setTitle("Broadcast Message");

      const messageInput = new TextInputBuilder()
        .setCustomId("message")
        .setLabel("Message")
        .setStyle(TextInputStyle.Paragraph);

      const delayInput = new TextInputBuilder()
        .setCustomId("delay")
        .setLabel("Delay (optional: 10m, 1h)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(delayInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // =========================
    // 📝 MODAL SUBMIT
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {

      await interaction.deferReply({ ephemeral: true });

      const targets = userSelections.get(interaction.user.id) || [];
      userSelections.delete(interaction.user.id);

      const messageContent = interaction.fields.getTextInputValue("message");
      const timeRaw = interaction.fields.getTextInputValue("delay");

      let delay = 0;

      if (timeRaw) {
        const num = parseInt(timeRaw);
        if (timeRaw.includes("m")) delay = num * 60000;
        else if (timeRaw.includes("h")) delay = num * 3600000;
        else if (timeRaw.includes("d")) delay = num * 86400000;
      }

      await interaction.editReply("🚀 Sending broadcast...");

      setTimeout(async () => {

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
              const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle("📢 Company Update")
                .setDescription(messageContent)
                .setFooter({ text: "Inter Molds, Inc." })
                .setTimestamp();

              await member.send({ embeds: [embed] });
              success++;
            } catch {}
          }
        }

        await interaction.followUp({
          content: `✅ Sent to ${success} users`
        });

      }, delay);

      return;
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
