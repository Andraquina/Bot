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
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder
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

// =========================
// STATE
// =========================
const session = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();
const processingUsers = new Set();

// =========================
// READY
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands registered");
  } catch (error) {
    console.error(error);
  }
});

// =========================
// HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatWords(str) {
  if (!str) return "";
  return str.toLowerCase().split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getAcronym(company) {
  const words = company.split(/\s+/);
  if (words.length === 1) return company.substring(0, 3).toUpperCase();
  return words.map(w => w[0].toUpperCase()).join('');
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

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
      { label: "ALL", value: "all", default: selected.includes("all") },
      ...roles.map(r => ({
        label: r,
        value: r,
        default: selected.includes(r)
      }))
    ]);
}

// =========================
// JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c =>
    c.name.toLowerCase().includes("welcome")
  );

  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_onboarding_modal')
      .setLabel('Start Setup')
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `<@${member.id}> Welcome! Click below to start.`,
    components: [row]
  });

  onboardingData.set(member.id, {
    welcomeMsgId: msg.id,
    welcomeChannelId: channel.id
  });
});

// =========================
// INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    // SLASH SETUP
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      const btn = new ButtonBuilder()
        .setCustomId("start_broadcast")
        .setLabel("📢 Start Broadcast")
        .setStyle(ButtonStyle.Primary);

      await interaction.channel.send({
        content: "📢 **Broadcast Panel**",
        components: [new ActionRowBuilder().addComponents(btn)]
      });

      return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
    }

    // MODAL SUBMITS
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');

        onboardingData.set(interaction.user.id, {
          ...onboardingData.get(interaction.user.id),
          name,
          company
        });

        const adminChannel = interaction.guild.channels.cache.find(c =>
          c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText
        );

        if (!adminChannel) return interaction.reply({ content: "❌ Admin channel not found.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChannel.send({
          content: `🚨 **New Registration Request**\n\n**User:** <@${interaction.user.id}>\n**Name:** ${name}\n**Company:** ${company}`,
          components: [row]
        });

        // 5. AUTO DELETE WELCOME MESSAGE
        const data = onboardingData.get(interaction.user.id);
        if (data && data.welcomeMsgId && data.welcomeChannelId) {
          const welcomeChannel = interaction.guild.channels.cache.get(data.welcomeChannelId);
          if (welcomeChannel) {
            welcomeChannel.messages.fetch(data.welcomeMsgId).then(m => m.delete().catch(() => {})).catch(() => {});
          }
        }

        return interaction.reply({ content: "✅ Information sent to admins.", ephemeral: true });
      }

      // BROADCAST MODAL
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        if (!data) return;

        const text = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();

        const targetMembers = members.filter(m =>
          !m.user.bot && (data.targets.includes("all") || m.roles.cache.some(r => data.targets.some(t => isSameCompany(r.name, t))))
        );

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );

        await data.message.edit({
          content: `📢 **Preview**\n\n🎯 Targets: ${data.targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\n💬 ${text}`,
          components: [buttons]
        });

        session.set(interaction.user.id, { ...data, messageContent: text, targetMembers });
      }
    }

    // BUTTONS
    if (interaction.isButton()) {
      // START SETUP BUTTON
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Inter Molds Registration');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Full Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company Name').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // APPROVE BUTTON
      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const data = onboardingData.get(userId);
        if (!data) return interaction.reply({ content: "❌ Session expired.", ephemeral: true });

        await interaction.deferUpdate();
        const member = await interaction.guild.members.fetch(userId);
        const name = formatWords(data.name);
        const company = formatWords(data.company);

        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company));
        if (!role) role = await interaction.guild.roles.create({ name: company });

        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`).catch(() => {});

        // 4. HIDE WELCOME FROM NEW ROLE
        const welcomeChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
        if (welcomeChannel) {
          await welcomeChannel.permissionOverwrites.create(role.id, { ViewChannel: false }).catch(() => {});
          await welcomeChannel.permissionOverwrites.create(member.id, { ViewChannel: false }).catch(() => {});
        }

        // CREATE CHANNELS
        const category = await interaction.guild.channels.create({
          name: company,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
          ]
        });

        await interaction.guild.channels.create({ name: 'general', type: ChannelType.GuildText, parent: category.id });
        await interaction.guild.channels.create({ name: 'Voice Call', type: ChannelType.GuildVoice, parent: category.id });

        // 3. DM RULES
        await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`).catch(() => {});
        await member.send({
          embeds: [new EmbedBuilder().setTitle("📜 Rules").setDescription("• Be respectful\n• No spam\n• Follow professional guidelines.").setColor(0xF1C40F)]
        }).catch(() => {});

        // 2. CLEAN STANDALONE APPROVAL MESSAGE
        await interaction.channel.send({
          content: `✅ Approved **${name}** from **${company}**`
        });
        
        await interaction.message.delete().catch(() => {});
      }

      // DENY BUTTON
      if (interaction.customId.startsWith("deny_")) {
        const userId = interaction.customId.split("_")[1];
        await interaction.message.delete().catch(() => {});
        return interaction.reply({ content: `❌ Denied access for <@${userId}>`, ephemeral: true });
      }

      // START BROADCAST
      if (interaction.customId === "start_broadcast") {
        await interaction.deferReply({ ephemeral: true });
        const dropdown = await buildDropdown(interaction.guild);
        const reply = await interaction.editReply({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
        session.set(interaction.user.id, { message: reply });
      }

      // BROADCAST CONFIRM
      if (interaction.customId === "confirm") {
        const data = session.get(interaction.user.id);
        if (!data) return;
        const { targetMembers, messageContent, message, targets } = data;

        await interaction.update({ content: `🚀 Sending... (0/${targetMembers.size})`, components: [] });

        let i = 0;
        let success = 0;
        for (const m of targetMembers.values()) {
          i++;
          try {
            await m.send({
              embeds: [new EmbedBuilder()
                .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db)
                .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
                .setDescription(messageContent)
                .setFooter({ text: "Inter Molds, Inc." })
                .setTimestamp()]
            });
            success++;
          } catch {}
          if (i % 5 === 0 || i === targetMembers.size) await message.edit({ content: `🚀 Sending... (${i}/${targetMembers.size})` });
        }

        await message.edit({ content: `✅ **Broadcast Completed**\n🎯 Targets: ${targets.join(", ")}\n👥 Sent: ${success}` });
        session.delete(interaction.user.id);
      }

      // BROADCAST BACK / CANCEL
      if (interaction.customId === "back") {
        const data = session.get(interaction.user.id);
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        return interaction.update({ content: "Select targets", components: [new ActionRowBuilder().addComponents(dropdown)] });
      }
      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }
    }

    // DROPDOWN BROADCAST
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });

      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)));
      return interaction.showModal(modal);
    }

  } catch (err) {
    console.error(err);
  }
});

// =========================
// DM SYSTEM
// =========================
client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;

  repliedUsers.add(msg.author.id);
  await msg.reply("📩 **Inter Molds System**\nThis bot is for notifications only. Please contact an administrator if you need assistance.");
});

client.login(process.env.TOKEN);
