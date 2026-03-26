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
// STATE MANAGEMENT
// =========================
const session = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();
const processingUsers = new Set();
const guildMemberCache = new Map();

// =========================
// READY & SLASH COMMANDS
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel'),
    new SlashCommandBuilder()
      .setName('create-production')
      .setDescription('Create the permanent Production Channel button')
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

async function buildDropdown(guild, selected = [], customId = "select_companies") {
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name)
    .slice(0, 25);
    
  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select company role")
    .setMinValues(1)
    .setMaxValues(customId === "prod_select" ? 1 : Math.min(roles.length + 1, 25));

  const options = [];
  if (customId !== "prod_select") {
    options.push({ label: "ALL", value: "all", default: selected.includes("all") });
  }
  
  roles.forEach(roleName => {
    options.push({ label: roleName, value: roleName, default: selected.includes(roleName) });
  });

  dropdown.addOptions(options);
  return dropdown;
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
// JOIN (5-Minute Idle Timer)
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
    content: `<@${member.id}> Welcome! Click below to get started. You have **5 minutes** before this session expires.`,
    components: [row]
  });

  onboardingData.set(member.id, {
    welcomeMsgId: msg.id,
    welcomeChannelId: channel.id,
    status: 'idle' 
  });

  setTimeout(async () => {
    const data = onboardingData.get(member.id);
    if (data && data.status === 'idle') {
      try {
        const welcomeChannel = member.guild.channels.cache.get(data.welcomeChannelId);
        if (welcomeChannel) {
          const m = await welcomeChannel.messages.fetch(data.welcomeMsgId).catch(() => null);
          if (m) await m.delete().catch(() => {});
        }
        await member.kick("Onboarding timeout").catch(() => {});
      } catch (e) {} finally { onboardingData.delete(member.id); }
    }
  }, 5 * 60 * 1000);
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
        await createPanel(interaction.channel);
        return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
      }
      if (interaction.commandName === "create-production") {
        const btn = new ButtonBuilder().setCustomId("start_production").setLabel("🏗️ Create Production").setStyle(ButtonStyle.Success);
        await interaction.channel.send({ content: "🏗️ **Production Panel**\nClick below to create a new Mold channel:", components: [new ActionRowBuilder().addComponents(btn)] });
        return interaction.reply({ content: "✅ Production Panel created.", ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const data = session.get(interaction.user.id);

      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        if (!data) return;
        const messageContent = interaction.fields.getTextInputValue("message");
        const delayValue = interaction.fields.getTextInputValue("delay") || "0";
        const targets = data.targets;
        let members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m => !m.user.bot && (targets.includes("all") || m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))));
        const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger));
        
        await data.message.edit({ 
          content: `📢 **Broadcast Preview**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\n💬 Message: ${messageContent}`, 
          components: [buttons] 
        });
        session.set(interaction.user.id, { ...data, messageContent, targetMembers, delay: delayValue });
      }

      if (interaction.customId === "production_modal") {
        await interaction.deferUpdate();
        if (!data) return;
        const moldName = interaction.fields.getTextInputValue("mold_name");
        const roleName = data.targets[0];
        
        const previewRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("confirm_prod").setLabel("Confirm Creation").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );

        await data.message.edit({
            content: `🏗️ **Production Preview**\n\n🏢 **Company:** ${roleName}\n🎰 **Mold Name:** ${moldName}`,
            components: [previewRow]
        });

        session.set(interaction.user.id, { ...data, moldName });
      }

      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        const currentData = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, { ...currentData, name, company, status: 'submitted' });

        const adminChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText);
        if (!adminChannel) return interaction.reply({ content: "❌ Admin channel not found.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger));
        await adminChannel.send({ content: `🚨 New request\n\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`, components: [row] });
        
        // FIXED timing: Wipe the welcome channel immediately upon submission
        const welcomeChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
        if (welcomeChannel) {
          const messages = await welcomeChannel.messages.fetch({ limit: 100 });
          await welcomeChannel.bulkDelete(messages).catch(() => {});
        }

        return interaction.reply({ content: "✅ Information submitted. Please wait for administrator approval.", ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);
      
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Setup');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "start_broadcast") {
        await interaction.deferUpdate();
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.channel.send({ content: "\n🎯 Select companies:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      if (interaction.customId === "start_production") {
        await interaction.deferUpdate();
        const dropdown = await buildDropdown(interaction.guild, [], "prod_select");
        const msg = await interaction.channel.send({ 
            content: "\n🏗️ **Production Setup**\nSelect company role:", 
            components: [new ActionRowBuilder().addComponents(dropdown)] 
        });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      if (interaction.customId === "confirm_prod" && data) {
        await interaction.update({ content: `🏗️ Creating channel...`, components: [] });
        const { moldName, message } = data;
        const roleName = data.targets[0];
        const role = interaction.guild.roles.cache.find(r => r.name === roleName);
        const category = interaction.guild.channels.cache.find(c => c.name === role.name && c.type === ChannelType.GuildCategory);

        if (!category) return interaction.channel.send({ content: "❌ Category not found." });

        const basicPerms = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
        const newChan = await interaction.guild.channels.create({
          name: moldName,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: basicPerms, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }
          ]
        });

        await interaction.channel.send({ content: `✅ **Production Created**\n\n🏢 **Company:** ${roleName}\n🎰 **Mold ID:** ${moldName}` });
        await message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return;
      }

      if (interaction.customId === "confirm" && data) {
        const { targetMembers, messageContent, message, targets, delay } = data;
        await interaction.update({
          content: `🚀 Sending... (0/${targetMembers.size})`,
          components: []
        });

        const delayMs = (parseInt(delay) || 0) * 1000;
        let i = 0; let success = 0;
        for (const member of targetMembers.values()) {
          i++;
          try {
            await member.send({
              embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📢 Announcement").setDescription(messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()]
            });
            success++;
          } catch {}
          
          if (i % 2 === 0 || i === targetMembers.size) {
            await message.edit({ content: `🚀 Sending... (${i}/${targetMembers.size})` }).catch(() => {});
          }

          if (delayMs > 0 && i < targetMembers.size) await new Promise(r => setTimeout(r, delayMs));
        }

        await interaction.channel.send({
          content: `✅ **Broadcast Completed**\n\n🎯 Targets: ${targets.join(", ")}\n👤 Sent: ${success}\n💬 ${messageContent}`
        });

        await message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return;
      }

      if (interaction.customId === "back" && data) {
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        return interaction.update({ content: "🎯 Select companies:", components: [new ActionRowBuilder().addComponents(dropdown)] });
      }

      if (interaction.customId === "cancel" && data) {
        if (data.message) await data.message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return;
      }

      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const onboard = onboardingData.get(userId);
        if (!onboard) return;
        await interaction.reply({ content: "⏳ Processing...", ephemeral: true });
        const member = await interaction.guild.members.fetch(userId);
        const name = formatWords(onboard.name);
        const company = formatWords(onboard.company);
        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company)) || await interaction.guild.roles.create({ name: company });
        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`);
        let category = interaction.guild.channels.cache.find(c => c.name === company && c.type === ChannelType.GuildCategory);
        if (!category) {
          category = await interaction.guild.channels.create({ name: company, type: ChannelType.GuildCategory, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }] });
          const basic = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
          await interaction.guild.channels.create({ name: 'general', type: ChannelType.GuildText, parent: category.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basic, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }] });
          await interaction.guild.channels.create({ name: 'Voice Call', type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basic }] });
        }
        
        // ACCEPTANCE DM
        await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`).catch(() => {});

        // RULES DM
        const rules = new EmbedBuilder()
          .setTitle("📜 Inter Molds | Server Guidelines")
          .setColor(0xF1C40F)
          .setDescription(
            "**1. Account & Technical Setup**\n" +
            "• Please ensure you login using your **official company email** to avoid future access issues.\n" +
            "• For the best experience and reliable notifications, we strongly recommend **downloading the Discord app** instead of using the browser.\n\n" +
            "**2. Privacy & Communication**\n" +
            "• All company-specific channels are **strictly private** and destined only for your organization.\n" +
            "• If you have general questions, please use the `general` channel created for your company.\n\n" +
            "**3. Mold Tracking & Production**\n" +
            "• Admins will create a specific channel for every different mold/production.\n" +
            "• Each channel will have an associated link; please keep the conversation in those channels **strictly related** to that specific production for easier access.\n\n" +
            "**4. Team Members**\n" +
            "• If more people from your company wish to join, they are welcome! Just ensure they use the **exact same company name** during their setup process.\n\n" +
            "**5. Support & Updates**\n" +
            "• For specific or private problems, you can **Direct Message (DM) an Admin** by clicking our avatar on the right side and selecting 'Send Message'.\n" +
            "• Server updates will be notified via this Bot through DM. Please avoid accessing the server during those maintenance periods."
          )
          .setFooter({ text: "Inter Molds, Inc. - Professional Mold Solutions" });
        
        await member.send({ embeds: [rules] }).catch(() => {});
        
        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });
        onboardingData.delete(userId);
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "select_companies" || interaction.customId === "prod_select") {
        const data = session.get(interaction.user.id) || {};
        session.set(interaction.user.id, { ...data, targets: interaction.values });

        if (interaction.customId === "select_companies") {
          const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay (seconds)").setStyle(TextInputStyle.Short).setPlaceholder("0").setRequired(false))
          );
          await interaction.showModal(modal);
        } else {
          const modal = new ModalBuilder().setCustomId("production_modal").setTitle("Mold Details");
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("mold_name").setLabel("Mold Name").setStyle(TextInputStyle.Short).setRequired(true))
          );
          return interaction.showModal(modal);
        }
      }
    }
  } catch (err) { console.error("Error:", err); }
});

// =========================
// DM REDIRECTION
// =========================
client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);

  const dmEmbed = new EmbedBuilder()
    .setColor(0x2F3136)
    .setAuthor({ 
      name: 'IMI | Inter Molds System', 
      iconURL: client.user.displayAvatarURL() 
    })
    .setTitle("✉️ Inter Molds System")
    .setDescription(
      "This bot is used for notifications only.\n" +
      "We do not receive or monitor messages sent here.\n\n" +
      "If you need assistance, please contact us through our official channels."
    )
    .setFooter({ text: "Official System Notification" })
    .setTimestamp();

  await msg.reply({ embeds: [dmEmbed] });
});

client.login(process.env.TOKEN);
