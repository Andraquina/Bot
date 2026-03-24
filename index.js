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

// Global States
const session = new Map();
const guildMemberCache = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();

// =========================
// 🚀 ON READY & REGISTER
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');
  const commands = [
    new SlashCommandBuilder().setName('setup-broadcast').setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands registered");
  } catch (error) { console.error(error); }
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function formatTitleCase(str) {
  return str.toLowerCase().split(/\s+/).filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getAcronym(company) {
  const words = company.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.map(w => w[0].toUpperCase()).join('');
}

function isSameCompany(a, b) {
  const na = normalize(a); const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name).slice(0, 25);

  return new StringSelectMenuBuilder()
    .setCustomId("select_companies")
    .setPlaceholder("Select companies")
    .setMinValues(1)
    .setMaxValues(Math.min(roles.length + 1, 25))
    .addOptions([
      { label: "ALL", value: "all", default: selected.includes("all") },
      ...roles.map(r => ({ label: r, value: r, default: selected.includes(r) }))
    ]);
}

async function createPanel(channel) {
  const button = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
  return await channel.send({
    content: "📢 **Broadcast Panel**\nClick below to start:",
    components: [new ActionRowBuilder().addComponents(button)]
  });
}

// =========================
// 👋 ON USER JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary)
  );

  const welcomeMsg = await channel.send({
    content: `Welcome <@${member.id}>! To access the server, please click the button below to register.`,
    components: [row]
  });

  onboardingData.set(member.id, { welcomeMsgId: welcomeMsg.id, welcomeChannelId: channel.id });
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused() || "";
      const parts = focused.split(";");
      const current = parts[parts.length - 1].trim().toLowerCase();
      const roles = interaction.guild.roles.cache.filter(r => r.name !== "@everyone").map(r => r.name);
      const starts = roles.filter(r => r.toLowerCase().startsWith(current));
      const includes = roles.filter(r => r.toLowerCase().includes(current) && !starts.includes(r));
      let results = [...starts, ...includes];
      const selected = parts.slice(0, -1).map(p => p.trim().toLowerCase());
      results = results.filter(r => !selected.includes(r.toLowerCase()));
      if (!selected.includes("all")) results.unshift("ALL");
      results = results.slice(0, 25);
      const suggestions = results.map(name => {
        const newParts = [...parts];
        newParts[newParts.length - 1] = name;
        return { name: newParts.join("; "), value: newParts.join("; ") };
      });
      return await interaction.respond(suggestions);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      await createPanel(interaction.channel);
      return interaction.reply({ content: "✅ Panel created.", flags: [4096] });
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Company Registration');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Your Full Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Your Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {
        const [action, userId] = interaction.customId.split('_');
        const data = onboardingData.get(userId);
        if (!data) return interaction.reply({ content: "Session expired.", flags: [4096] });
        const member = await interaction.guild.members.fetch(userId).catch(() => null);

        if (action === 'approve') {
          if (!member) return interaction.reply({ content: "User left.", flags: [4096] });
          
          const cleanName = formatTitleCase(data.name);
          const cleanCompany = formatTitleCase(data.company);
          const acronym = getAcronym(cleanCompany);

          try { await member.setNickname(`${cleanName} | ${acronym}`); } catch (e) {}

          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, cleanCompany));
          if (!role) role = await interaction.guild.roles.create({ name: cleanCompany, color: 0x3498db });
          await member.roles.add(role);

          const category = await interaction.guild.channels.create({
            name: cleanCompany,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
          });

          // Text Channel Permissions
          await interaction.guild.channels.create({
            name: `general`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              {
                id: role.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.SendMessagesInThreads,
                  PermissionsBitField.Flags.CreatePublicThreads,
                  PermissionsBitField.Flags.EmbedLinks,
                  PermissionsBitField.Flags.AttachFiles,
                  PermissionsBitField.Flags.AddReactions,
                  PermissionsBitField.Flags.UseExternalStickers,
                  PermissionsBitField.Flags.PinMessages,
                  PermissionsBitField.Flags.ReadMessageHistory,
                  PermissionsBitField.Flags.SendTTSMessages,
                  PermissionsBitField.Flags.SendVoiceMessages,
                  PermissionsBitField.Flags.CreatePolls
                ]
              }
            ]
          });

          // Voice Call Permissions
          await interaction.guild.channels.create({
            name: `Voice Call`,
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              {
                id: role.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                  PermissionsBitField.Flags.Stream,
                  PermissionsBitField.Flags.UseVAD,
                  PermissionsBitField.Flags.PrioritySpeaker,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.EmbedLinks,
                  PermissionsBitField.Flags.AttachFiles,
                  PermissionsBitField.Flags.AddReactions,
                  PermissionsBitField.Flags.UseExternalEmojis,
                  PermissionsBitField.Flags.UseExternalStickers,
                  PermissionsBitField.Flags.ReadMessageHistory,
                  PermissionsBitField.Flags.SendTTSMessages,
                  PermissionsBitField.Flags.SendVoiceMessages,
                  PermissionsBitField.Flags.CreatePolls
                ]
              }
            ]
          });

          if (data.welcomeMsgId && data.welcomeChannelId) {
            const welcomeChan = interaction.guild.channels.cache.get(data.welcomeChannelId);
            if (welcomeChan) {
              const msg = await welcomeChan.messages.fetch(data.welcomeMsgId).catch(() => null);
              if (msg) await msg.delete().catch(() => null);
              await welcomeChan.permissionOverwrites.create(member.id, { ViewChannel: false });
            }
          }

          try {
            await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`);
            const rulesEmbed = new EmbedBuilder().setColor(0xF1C40F).setTitle('📜 Company Rules').setDescription('──────────────\n\n**1. Be respectful**\n**2. No spam**\n**3. Follow all guidelines**\n**4. Keep discussions professional**\n**5. Respect privacy**\n\n──────────────').setFooter({ text: `Inter Molds, Inc. • ${new Date().toLocaleDateString('pt-PT')} ${new Date().toLocaleTimeString('pt-PT', {hour: '2-digit', minute:'2-digit'})}`, iconURL: interaction.guild.iconURL() });
            await member.send({ embeds: [rulesEmbed] });
          } catch (e) {}

          await interaction.update({ content: `✅ Approved ${cleanName}`, components: [] });
        } else {
          await interaction.update({ content: `❌ Denied ${data.name}`, components: [] });
        }
        onboardingData.delete(userId);
        return;
      }

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

      const data = session.get(interaction.user.id);
      if (!data) return;

      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      if (interaction.customId === "back") {
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        session.set(interaction.user.id, { message: data.message });
        return interaction.update({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      if (interaction.customId === "confirm") {
        const { targetMembers, messageContent, message, targets } = data;
        await interaction.update({ content: `🚀 Sending... (0/${targetMembers.size})`, components: [] });

        let i = 0; let success = 0; let failed = 0;
        for (const m of targetMembers.values()) {
          i++;
          try {
            await m.send({
              embeds: [new EmbedBuilder()
                .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db)
                .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
                .setDescription(messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()]
            });
            success++;
          } catch { failed++; }
          if (i % 2 === 0 || i === targetMembers.size) await message.edit({ content: `🚀 Sending... (${i}/${targetMembers.size})` });
        }
        await message.edit({ content: `✅ **Broadcast Completed**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Sent: ${success}\n❌ Failed: ${failed}\n\n💬 ${messageContent}` });
        session.delete(interaction.user.id);
      }
    }

    if (interaction.isStringSelectMenu()) {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });
      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay (optional)").setStyle(TextInputStyle.Short).setRequired(false))
      );
      await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        const current = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, { ...current, name, company });

        const adminChan = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText);
        if (!adminChan) return interaction.reply({ content: "Error: No admin channel.", flags: [4096] });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        await adminChan.send({ content: `🔔 **New Request**\n**User:** <@${interaction.user.id}>\n**Name:** ${name}\n**Company:** ${company}`, components: [row] });
        return interaction.reply({ content: "✅ Submitted. Wait for approval.", flags: [4096] });
      }

      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        if (!data) return;
        const messageContent = interaction.fields.getTextInputValue("message");
        const targets = data.targets;
        let members = guildMemberCache.get(interaction.guild.id);
        if (!members) { members = await interaction.guild.members.fetch(); guildMemberCache.set(interaction.guild.id, members); }
        const targetMembers = members.filter(m => !m.user.bot && (targets.includes("all") || m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))));
        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        await data.message.edit({ content: `📢 **Preview**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\n💬 ${messageContent}`, components: [buttons] });
        session.set(interaction.user.id, { ...data, messageContent, targetMembers });
      }
    }
  } catch (err) { console.error(err); }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guild) return;
  if (repliedUsers.has(message.author.id)) return;
  await message.reply("📩 **Inter Molds System**\nThis bot is for notifications only.");
  repliedUsers.add(message.author.id);
});

client.login(process.env.TOKEN);
