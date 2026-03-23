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


// =========================
// 🔥 STATE STORAGE
// =========================

const selections = new Map();


// =========================
// 📩 DM AUTO RESPONSE
// =========================

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (!message.guild) {
    await message.reply(
      "📩 **Inter Molds System**\n\nThis bot is used for notifications only."
    );
  }
});


// =========================
// 📋 INTERACTIONS
// =========================

client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // 🚀 START BROADCAST
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

      const row1 = new ActionRowBuilder().addComponents(buttons);

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("select_all").setLabel("ALL").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("next_step").setLabel("Next ➜").setStyle(ButtonStyle.Success)
      );

      selections.set(interaction.user.id, { targets: [] });

      await interaction.editReply({
        content: "🎯 **Select target companies:**",
        components: [row1, row2]
      });

      return;
    }


    // =========================
    // 🎯 BUTTONS
    // =========================
    if (interaction.isButton()) {

      const data = selections.get(interaction.user.id);
      if (!data) return;

      if (interaction.customId.startsWith("select_")) {

        const company = interaction.customId.replace("select_", "");

        if (company === "all") {
          data.targets = ["all"];
        } else {
          if (data.targets.includes(company)) {
            data.targets = data.targets.filter(c => c !== company);
          } else {
            data.targets.push(company);
          }
        }

        return interaction.update({
          content: `🎯 Selected: ${data.targets.join(", ") || "None"}`,
          components: interaction.message.components
        });
      }

      // =========================
      // ➜ NEXT STEP (OPEN MODAL)
      // =========================
      if (interaction.customId === "next_step") {

        if (!data.targets.length) {
          return interaction.reply({ content: "❌ Select at least one.", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId("broadcast_modal")
          .setTitle("Create Broadcast");

        const messageInput = new TextInputBuilder()
          .setCustomId("message")
          .setLabel("Message")
          .setStyle(TextInputStyle.Paragraph);

        const delayInput = new TextInputBuilder()
          .setCustomId("delay")
          .setLabel("Delay (optional: 10m, 1h, etc)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(messageInput),
          new ActionRowBuilder().addComponents(delayInput)
        );

        await interaction.showModal(modal);
      }
    }


    // =========================
    // 📝 MODAL SUBMIT
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {

      await interaction.deferReply({ ephemeral: true });

      const data = selections.get(interaction.user.id);
      if (!data) return;

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
            data.targets.includes("all") ||
            member.roles.cache.some(role =>
              data.targets.some(t => isSameCompany(role.name, t))
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

        selections.delete(interaction.user.id);

        await interaction.followUp({
          content: `✅ Sent to ${success} users`
        });

      }, delay);
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
