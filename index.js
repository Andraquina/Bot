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
    GatewayIntentBits.MessageContent
  ]
});

const session = new Map();
const guildMemberCache = new Map();

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
// 🧠 HELPERS (UNCHANGED)
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractKeywords(str) {
  return str.toLowerCase().split(/\s+/);
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

  const wordsA = extractKeywords(a);
  const wordsB = extractKeywords(b);

  const common = wordsA.filter(w => wordsB.includes(w));

  return common.length >= Math.min(wordsA.length, wordsB.length) / 2;
}

function safeCompanyId(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}


// =========================
// 👋 ON USER JOIN (UNCHANGED)
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
    // 🔘 OPEN FORM
    // =========================
    if (interaction.isButton() && interaction.customId === 'open_form') {

      try { await interaction.message.delete(); } catch {}

      const modal = new ModalBuilder()
        .setCustomId('user_form')
        .setTitle('Enter your info');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Your Name')
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('company')
            .setLabel('Your Company')
            .setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // =========================
    // 📋 USER FORM
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === 'user_form') {

      await interaction.deferReply({ ephemeral: true });

      let name = formatWords(interaction.fields.getTextInputValue('name'));
      let company = formatWords(interaction.fields.getTextInputValue('company'));

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const companyShort = getAcronym(company);

      let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company));
      let category = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        isSameCompany(c.name, company)
      );

      try {
        let nickname = `${name} | ${companyShort}`;
        if (nickname.length > 32) nickname = nickname.slice(0, 32);
        await member.setNickname(nickname);
      } catch {}

      if (role && category) {
        await member.roles.add(role);
        return interaction.editReply({ content: `Welcome ${name} from ${company} 🎉` });
      }

      const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
      if (pendingRole) await member.roles.add(pendingRole);

      const approveBtn = new ButtonBuilder()
        .setCustomId(`approve_${member.id}_${safeCompanyId(company)}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success);

      const rejectBtn = new ButtonBuilder()
        .setCustomId(`reject_${member.id}_${safeCompanyId(company)}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger);

      const adminChannel = interaction.guild.channels.cache.find(c => c.name === "admin");

      if (adminChannel) {
        await adminChannel.send({
          content:
            `🚨 New company request\n\n` +
            `User: <@${member.id}>\n` +
            `Company: ${company}`,
          components: [new ActionRowBuilder().addComponents(approveBtn, rejectBtn)]
        });
      }

      return interaction.editReply({
        content: `Thanks! We’re setting things up for you ⏳`
      });
    }

    // =========================
    // 📢 SETUP BROADCAST PANEL
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {

      const button = new ButtonBuilder()
        .setCustomId("start_broadcast")
        .setLabel("📢 Start Broadcast")
        .setStyle(ButtonStyle.Primary);

      await interaction.channel.send({
        content: "📢 **Broadcast Panel**",
        components: [new ActionRowBuilder().addComponents(button)]
      });

      return interaction.reply({ content: "✅ Panel created", ephemeral: true });
    }

    // =========================
    // 🚀 START BROADCAST
    // =========================
    if (interaction.isButton() && interaction.customId === "start_broadcast") {

      const roles = interaction.guild.roles.cache
        .filter(r => r.name !== "@everyone" && !r.managed)
        .map(r => ({ label: r.name, value: r.name }))
        .slice(0, 25);

      const dropdown = new StringSelectMenuBuilder()
        .setCustomId("select_companies")
        .setMinValues(1)
        .setMaxValues(roles.length)
        .addOptions([{ label: "ALL", value: "all" }, ...roles]);

      const msg = await interaction.reply({
        content: "🎯 Select companies:",
        components: [new ActionRowBuilder().addComponents(dropdown)]
      });

      session.set(interaction.user.id, { message: msg });
      return;
    }

    // =========================
    // DROPDOWN
    // =========================
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {

      const data = session.get(interaction.user.id) || {};

      session.set(interaction.user.id, {
        ...data,
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
    // MODAL
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {

      await interaction.deferUpdate();

      const data = session.get(interaction.user.id);
      if (!data) return;

      const messageContent = interaction.fields.getTextInputValue("message");
      const targets = data.targets;

      let members = await interaction.guild.members.fetch();

      const targetMembers = members.filter(m =>
        !m.user.bot &&
        (
          targets.includes("all") ||
          m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))
        )
      );

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      await data.message.edit({
        content:
          `📢 **Preview**\n\n` +
          `🎯 Targets: ${targets.join(", ")}\n` +
          `👥 Users: ${targetMembers.size}\n\n` +
          `💬 ${messageContent}`,
        components: [buttons]
      });

      session.set(interaction.user.id, {
        ...data,
        messageContent,
        targetMembers
      });
    }

    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton() && ["confirm","back","cancel"].includes(interaction.customId)) {

      const data = session.get(interaction.user.id);
      if (!data) return;

      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      if (interaction.customId === "back") {
        const roles = interaction.guild.roles.cache
          .filter(r => r.name !== "@everyone" && !r.managed)
          .map(r => ({ label: r.name, value: r.name }))
          .slice(0, 25);

        const dropdown = new StringSelectMenuBuilder()
          .setCustomId("select_companies")
          .setMinValues(1)
          .setMaxValues(roles.length)
          .addOptions([{ label: "ALL", value: "all" }, ...roles]);

        return interaction.update({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      if (interaction.customId === "confirm") {

        const { targetMembers, messageContent, message, targets } = data;

        await interaction.update({
          content: `🚀 Sending... (0/${targetMembers.size})`,
          components: []
        });

        let i = 0, success = 0, failed = 0;

        for (const member of targetMembers.values()) {
          i++;

          try {
            await member.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x3498db)
                  .setTitle("📢 Company Update")
                  .setDescription(messageContent)
                  .setFooter({ text: "Inter Molds, Inc." })
                  .setTimestamp()
              ]
            });
            success++;
          } catch {
            failed++;
          }

          if (i % 2 === 0 || i === targetMembers.size) {
            await message.edit({
              content: `🚀 Sending... (${i}/${targetMembers.size})`
            });
          }
        }

        await message.edit({
          content:
            `✅ **Broadcast Completed**\n\n` +
            `🎯 Targets: ${targets.join(", ")}\n` +
            `👥 Sent: ${success}\n` +
            `❌ Failed: ${failed}\n\n` +
            `💬 ${messageContent}`
        });

        session.delete(interaction.user.id);
      }
    }

  } catch (error) {
    console.error("ERROR:", error);
  }
});

client.login(process.env.TOKEN);
