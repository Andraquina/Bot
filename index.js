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
const guildMemberCache = new Map();

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
// 🧠 HELPERS
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

async function createPanel(channel) {
  const button = new ButtonBuilder()
    .setCustomId("start_broadcast")
    .setLabel("📢 Start Broadcast")
    .setStyle(ButtonStyle.Primary);
  return await channel.send({
    content: "📢 **Broadcast Panel**\nClick below to start:",
    components: [new ActionRowBuilder().addComponents(button)]
  });
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
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    // SETUP PANEL
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      await createPanel(interaction.channel);
      return interaction.reply({
        content: "✅ Panel created. (Tip: pin it)",
        ephemeral: true
      });
    }

    // MODAL SUBMISSIONS
    if (interaction.isModalSubmit()) {
      // BROADCAST PREVIEW
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        if (!data) return;
        const messageContent = interaction.fields.getTextInputValue("message");
        const targets = data.targets;
        
        let members = guildMemberCache.get(interaction.guild.id);
        if (!members) {
          members = await interaction.guild.members.fetch();
          guildMemberCache.set(interaction.guild.id, members);
        }
        
        const targetMembers = members.filter(m =>
          !m.user.bot && (targets.includes("all") || m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t))))
        );
        
        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        
        await data.message.edit({
          content: `📢 **Preview**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\nMessage: ${messageContent}`,
          components: [buttons]
        });
        
        session.set(interaction.user.id, {
          ...data,
          messageContent,
          targetMembers
        });
      }

      // ONBOARDING SUBMIT
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        onboardingData.set(interaction.user.id, { ...onboardingData.get(interaction.user.id), name, company });

        const adminChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText);
        if (!adminChannel) return interaction.reply({ content: "❌ Admin channel not found.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChannel.send({ content: `🚨 New request\n\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`, components: [row] });
        
        const entry = onboardingData.get(interaction.user.id);
        if (entry?.welcomeMsgId) {
          const welcomeChannel = interaction.guild.channels.cache.get(entry.welcomeChannelId);
          if (welcomeChannel) welcomeChannel.messages.fetch(entry.welcomeMsgId).then(m => m.delete().catch(() => {}));
        }

        return interaction.reply({ content: "✅ Sent to admins.", ephemeral: true });
      }
    }

    // STRING SELECT MENUS
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "select_companies") {
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
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("delay")
              .setLabel("Delay (10m optional)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
        return interaction.showModal(modal);
      }
    }

    // BUTTONS
    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);

      // START BROADCAST PANEL
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)],
          fetchReply: true
        });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      // START ONBOARDING (WELCOME BUTTON)
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder()
          .setCustomId('onboarding_modal')
          .setTitle('Setup');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // BROADCAST BACK
      if (interaction.customId === "back" && data) {
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        session.set(interaction.user.id, { message: data.message });
        return interaction.update({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      // BROADCAST CANCEL
      if (interaction.customId === "cancel" && data) {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      // BROADCAST CONFIRM
      if (interaction.customId === "confirm" && data) {
        const { targetMembers, messageContent, message, targets } = data;
        await interaction.update({
          content: `🚀 Sending... (0/${targetMembers.size})`,
          components: []
        });
        let i = 0; let success = 0; let failed = 0;
        for (const member of targetMembers.values()) {
          i++;
          try {
            await member.send({
              embeds: [new EmbedBuilder().setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db).setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update").setDescription(messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()]
            });
            success++;
          } catch { failed++; }
          if (i % 2 === 0 || i === targetMembers.size) {
            await message.edit({ content: `🚀 Sending... (${i}/${targetMembers.size})` });
          }
        }
        await interaction.channel.send({
          content: `✅ **Broadcast Completed**\n\n🎯 Targets: ${targets.join(", ")}\n👤 Sent: ${success}\n❌ Failed: ${failed}\n\n💬 ${messageContent}`
        });
        await message.delete().catch(() => {});
        session.delete(interaction.user.id);
      }

      // APPROVE ACTION
      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const dataOnboard = onboardingData.get(userId);
        if (!dataOnboard) return interaction.reply({ content: "❌ Session expired.", ephemeral: true });

        await interaction.reply({ content: "⏳ Processing approval...", ephemeral: true });

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.editReply({ content: "❌ Member no longer in server." });

        const name = formatWords(dataOnboard.name);
        const company = formatWords(dataOnboard.company);

        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company));
        if (!role) role = await interaction.guild.roles.create({ name: company });

        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`);

        const category = await interaction.guild.channels.create({
          name: company,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
          ]
        });

        const basicPerms = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
        const restrictPerms = [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ManageChannels];

        await interaction.guild.channels.create({ 
          name: 'general', 
          type: ChannelType.GuildText, 
          parent: category.id, 
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: basicPerms, deny: restrictPerms } 
          ] 
        });

        await interaction.guild.channels.create({ 
          name: 'Voice Call', 
          type: ChannelType.GuildVoice, 
          parent: category.id, 
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: basicPerms } 
          ] 
        });

        const welcomeChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
        if (welcomeChannel) {
          const newChannel = await welcomeChannel.clone();
          await welcomeChannel.delete().catch(() => {});
          await newChannel.setPosition(welcomeChannel.position);
          await newChannel.permissionOverwrites.create(role.id, { ViewChannel: false });
        }

        await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`).catch(() => {});
        await member.send({ embeds: [new EmbedBuilder().setTitle("📜 Rules").setDescription("Follow rules.").setColor(0xF1C40F)] }).catch(() => {});

        // 2. Send the Standalone Message (The one that stays in the chat)
        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });

        // 3. Delete the "thinking" message so it disappears from the admin's screen
        await interaction.deleteReply().catch(() => {});
        
        // 4. Delete the original request message with the buttons
        await interaction.message.delete().catch(() => {});

        // DMs to the user
        await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`).catch(() => {});
        await member.send({ embeds: [new EmbedBuilder().setTitle("📜 Rules").setDescription("Follow rules.").setColor(0xF1C40F)] }).catch(() => {});
      }

      // DENY ACTION
      if (interaction.customId.startsWith("deny_")) {
        const userId = interaction.customId.split("_")[1];
        
        // Use a hidden reply then delete it immediately to resolve the interaction without leaving a trace
        await interaction.reply({ content: "❌ Denying...", ephemeral: true });
        await interaction.deleteReply().catch(() => {});
        
        // Delete the original request message
        await interaction.message.delete().catch(() => {});
      }
      }
    }
  } catch (err) {
    console.error("Interaction Error:", err);
  }
});

// =========================
// DM SYSTEM
// =========================
client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);
  await msg.reply("📩 **Inter Molds System**\nThis bot is for notifications only. Please contact an administrator.");
});

client.login(process.env.TOKEN);
