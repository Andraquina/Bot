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

function safeCompanyId(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}


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
    // 🔍 PRO AUTOCOMPLETE
    // =========================
    if (interaction.isAutocomplete()) {
      try {
        const focused = interaction.options.getFocused() || "";

        const parts = focused.split(";");
        const current = parts[parts.length - 1].trim().toLowerCase();

        const roles = interaction.guild.roles.cache
          .filter(r => r.name !== "@everyone")
          .map(r => r.name);

        // 🔥 ranking
        const starts = roles.filter(r => r.toLowerCase().startsWith(current));
        const includes = roles.filter(r => r.toLowerCase().includes(current) && !starts.includes(r));

        let results = [...starts, ...includes];

        // 🔥 remove duplicates already selected
        const selected = parts.slice(0, -1).map(p => p.trim().toLowerCase());
        results = results.filter(r => !selected.includes(r.toLowerCase()));

        // 🔥 always include ALL
        if (!selected.includes("all")) {
          results.unshift("ALL");
        }

        results = results.slice(0, 25);

        const suggestions = results.map(name => {
          const newParts = [...parts];
          newParts[newParts.length - 1] = name;
          return {
            name: newParts.join("; "),
            value: newParts.join("; ")
          };
        });

        await interaction.respond(suggestions);

      } catch (err) {
        console.error("AUTOCOMPLETE ERROR:", err);
        try { await interaction.respond([]); } catch {}
      }

      return;
    }

    // =========================
    // 🚀 SLASH BROADCAST
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === 'broadcast') {

      await interaction.deferReply();

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({ content: "❌ Not allowed." });
      }

      const targets = interaction.options.getString('targets').toLowerCase().split(';').map(t => t.trim());
      const messageContent = interaction.options.getString('message');
      const timeRaw = interaction.options.getString('delay');

      let delay = 0;

      if (timeRaw) {
        const num = parseInt(timeRaw);
        if (timeRaw.includes("m")) delay = num * 60000;
        else if (timeRaw.includes("h")) delay = num * 3600000;
        else if (timeRaw.includes("d")) delay = num * 86400000;
      }

      const members = await interaction.guild.members.fetch();
      const targetMembers = [];

      for (const member of members.values()) {
        if (member.user.bot) continue;

        if (targets.includes("all")) {
          targetMembers.push(member);
          continue;
        }

        const match = member.roles.cache.some(role =>
          targets.some(t => isSameCompany(role.name, t))
        );

        if (match) targetMembers.push(member);
      }

      if (targetMembers.length === 0) {
        return interaction.editReply({ content: "❌ No users found." });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({
        content:
          `📢 **Broadcast Preview**\n\n` +
          `🎯 Targets: ${targets.join(", ")}\n` +
          `👥 Users: ${targetMembers.length}\n` +
          `⏱️ Delay: ${timeRaw || "none"}\n\n` +
          `💬 ${messageContent}`,
        components: [row]
      });

      const msg = await interaction.fetchReply();

      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 30000
      });

      collector.on('collect', async i => {

        if (i.customId === 'cancel') {
          await i.update({ content: "❌ Cancelled.", components: [] });
          return collector.stop();
        }

        if (i.customId === 'confirm') {

          await i.update({
            content: delay ? `⏳ Scheduled in ${timeRaw}` : "🚀 Preparing...",
            components: []
          });

          setTimeout(async () => {

            let success = 0;
            let failed = 0;
            const total = targetMembers.length;

            await msg.edit({ content: `🚀 Sending... (0/${total})` });

            for (let i = 0; i < total; i++) {

              const member = targetMembers[i];

              try {
                const embed = new EmbedBuilder()
                  .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db)
                  .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
                  .setDescription(messageContent)
                  .setFooter({
                    text: "Inter Molds, Inc.",
                    iconURL: "https://i.postimg.cc/NMBrjhC9/IMI-LOGO-BRANCO-(2).png"
                  })
                  .setTimestamp();

                await member.send({ embeds: [embed] });
                success++;

              } catch {
                failed++;
              }

              if (i % 5 === 0 || i === total - 1) {
                await msg.edit({ content: `🚀 Sending... (${i + 1}/${total})` });
              }
            }

            await msg.edit({
              content:
                `✅ **Broadcast Completed**\n\n` +
                `🎯 Targets: ${targets.join(", ")}\n` +
                `👥 Sent: ${success}\n` +
                `❌ Failed: ${failed}\n\n` +
                `💬 ${messageContent}`
            });

          }, delay);

          collector.stop();
        }
      });

      return;
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
