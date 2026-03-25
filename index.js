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

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
});

// =========================
// HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatWords(str) {
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

    // =========================
    // SLASH
    // =========================
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
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
    }

    // =========================
    // MODALS (FIXED FIRST)
    // =========================
    if (interaction.isModalSubmit()) {

      // 🔥 ONBOARDING FIX
      if (interaction.customId === 'onboarding_modal') {

        await interaction.deferReply({ ephemeral: true });

        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');

        onboardingData.set(interaction.user.id, {
          ...onboardingData.get(interaction.user.id),
          name,
          company
        });

        const adminChannel = interaction.guild.channels.cache.find(c =>
          c.name.toLowerCase().includes("admin") &&
          c.type === ChannelType.GuildText
        );

        if (!adminChannel) {
          return interaction.editReply({
            content: "❌ Admin channel not found."
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChannel.send({
          content:
            `🚨 New request\n\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`,
          components: [row]
        });

        return interaction.editReply({
          content: "✅ Sent to admins."
        });
      }

      // =========================
      // BROADCAST MODAL (FULL)
      // =========================
      if (interaction.customId === "broadcast_modal") {

        await interaction.deferUpdate();

        const data = session.get(interaction.user.id);
        if (!data) return;

        const text = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();

        const targetMembers = members.filter(m =>
          !m.user.bot &&
          (
            data.targets.includes("all") ||
            m.roles.cache.some(r =>
              data.targets.some(t => isSameCompany(r.name, t))
            )
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
            `🎯 Targets: ${data.targets.join(", ")}\n` +
            `👥 Users: ${targetMembers.size}\n\n` +
            `💬 ${text}`,
          components: [buttons]
        });

        session.set(interaction.user.id, {
          ...data,
          messageContent: text,
          targetMembers
        });
      }
    }

    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton()) {

      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder()
          .setCustomId('onboarding_modal')
          .setTitle('Setup');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short)
          )
        );

        return interaction.showModal(modal);
      }

      // APPROVE
      if (interaction.customId.startsWith("approve_")) {

        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split("_")[1];
        const data = onboardingData.get(userId);
        const member = await interaction.guild.members.fetch(userId);

        const name = formatWords(data.name);
        const company = formatWords(data.company);

        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company));
        if (!role) role = await interaction.guild.roles.create({ name: company });

        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`);

        // RULE ACCESS
        for (const ch of interaction.guild.channels.cache.values()) {
          if (ch.name.includes("rule") || ch.name.includes("announcement")) {
            await ch.permissionOverwrites.edit(role.id, {
              ViewChannel: true,
              SendMessages: false
            }).catch(()=>{});
          }
        }

        // CREATE CHANNELS
        const category = await interaction.guild.channels.create({
          name: company,
          type: ChannelType.GuildCategory
        });

        await interaction.guild.channels.create({
          name: 'general',
          type: ChannelType.GuildText,
          parent: category.id
        });

        await interaction.guild.channels.create({
          name: 'Voice Call',
          type: ChannelType.GuildVoice,
          parent: category.id
        });

        await member.send(`✅ Approved!`);
        await member.send({
          embeds: [new EmbedBuilder().setTitle("📜 Rules").setDescription("Follow rules.")]
        });

        await interaction.editReply({ content: `Approved ${name}` });
        await interaction.message.delete().catch(()=>{});
      }

      // START BROADCAST
      if (interaction.customId === "start_broadcast") {
        await interaction.deferReply();

        const dropdown = await buildDropdown(interaction.guild);

        const msg = await interaction.editReply({
          content: "Select targets",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });

        session.set(interaction.user.id, { message: msg });
      }

      // BACK
      if (interaction.customId === "back") {
        const data = session.get(interaction.user.id);
        const dropdown = await buildDropdown(interaction.guild, data.targets);

        return interaction.update({
          content: "Select targets",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      // CANCEL
      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({ content: "Cancelled", components: [] });
      }

      // CONFIRM
      if (interaction.customId === "confirm") {

        const data = session.get(interaction.user.id);
        const { targetMembers, messageContent, message } = data;

        await interaction.update({ content: "Sending...", components: [] });

        let i = 0;

        for (const m of targetMembers.values()) {
          i++;
          try { await m.send(messageContent); } catch {}

          await message.edit({ content: `Sending ${i}/${targetMembers.size}` });
        }

        await message.edit({ content: "Done" });
        session.delete(interaction.user.id);
      }
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
  await msg.reply("This bot does not reply.");
});

client.login(process.env.TOKEN);
