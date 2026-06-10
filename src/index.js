import { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } from 'discord.js';
import { getQueue, deleteQueue, LOOP_MODE } from './music-queue.js';
import { downloadMedia, cleanupFile } from './downloader.js';
import {
  nowPlayingEmbed,
  addedToQueueEmbed,
  queueEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  loopEmbed,
  stayEmbed,
  startedPlayingEmbed,
  controlButtons,
} from './embeds.js';

const pendingDownloads = new Map();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APPLICATION_ID;

if (!TOKEN || !APP_ID) {
  console.error('❌ DISCORD_BOT_TOKEN و DISCORD_APPLICATION_ID مطلوبان!');
  process.exit(1);
}

const ALLOWED_CHANNEL_ID = '1087354626573086761';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isAdminOrOwner(interaction) {
  if (!interaction.guild) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('شغّل موسيقى من يوتيوب (رابط أو كلمات بحث)')
      .setDMPermission(false)
      .addStringOption(opt =>
        opt.setName('query').setDescription('رابط يوتيوب أو كلمات البحث').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('download')
      .setDescription('تحميل مقطع من يوتيوب أو تيك توك أو أي موقع')
      .setDMPermission(true)
      .addStringOption(opt =>
        opt.setName('url').setDescription('رابط المقطع').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('format')
          .setDescription('نوع التحميل')
          .setRequired(false)
          .addChoices(
            { name: '🎵 صوت فقط (MP3)', value: 'audio' },
            { name: '🎬 فيديو فقط (MP4)', value: 'video' },
            { name: '📹 صوت + فيديو (MP4)', value: 'both' }
          )
      ),
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('📡 تسجيل الأوامر...');
    await rest.put(Routes.applicationCommands(APP_ID), { body: commands });
    console.log('✅ تم تسجيل الأوامر!');
  } catch (err) {
    console.error('❌ فشل تسجيل الأوامر:', err.message);
  }
}

client.once('ready', async () => {
  console.log(`✅ البوت شغّال: ${client.user.tag}`);
  client.user.setActivity('🎵 الموسيقى | /play', { type: 2 });
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  const isDM = !interaction.guild;
  if (!isDM && !isAdminOrOwner(interaction) && interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      embeds: [errorEmbed(`هذا البوت يعمل فقط في <#${ALLOWED_CHANNEL_ID}>`)],
      ephemeral: true,
    });
  }

  try {
    switch (commandName) {
      case 'play': await handlePlay(interaction); break;
      case 'download': await handleDownload(interaction); break;
    }
  } catch (err) {
    console.error(`خطأ في الأمر ${commandName}:`, err);
    const msg = { embeds: [errorEmbed(`حدث خطأ: ${err.message}`)], ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

async function handleButton(interaction) {
  const queue = getQueue(interaction.guildId);
  const id = interaction.customId;

  try {
    if (id === 'ctrl_pause') {
      const paused = queue.pause();
      if (paused) {
        await queue.updateNowPlayingButtons(true);
        await interaction.reply({ embeds: [successEmbed('⏸ تم إيقاف الموسيقى مؤقتاً')], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [errorEmbed('لا توجد موسيقى تعزف!')], ephemeral: true });
      }

    } else if (id === 'ctrl_resume') {
      const resumed = queue.resume();
      if (resumed) {
        await queue.updateNowPlayingButtons(false);
        await interaction.reply({ embeds: [successEmbed('▶️ تم استئناف الموسيقى')], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [errorEmbed('الموسيقى تعزف بالفعل!')], ephemeral: true });
      }

    } else if (id === 'ctrl_skip') {
      const current = queue.getCurrentTrack();
      queue.skip();
      await interaction.reply({ embeds: [successEmbed(`⏭ تم تخطي: **${current?.title || 'الأغنية'}**`)], ephemeral: true });

    } else if (id === 'ctrl_stop') {
      queue.stop();
      queue.destroy();
      await interaction.reply({ embeds: [successEmbed('⏹ تم إيقاف الموسيقى ومسح القائمة')], ephemeral: true });

    } else if (id === 'ctrl_loop') {
      const current = queue.loopMode;
      if (current === LOOP_MODE.NONE) {
        queue.setLoop(LOOP_MODE.TRACK, 0);
      } else if (current === LOOP_MODE.TRACK) {
        queue.setLoop(LOOP_MODE.QUEUE);
      } else {
        queue.setLoop(LOOP_MODE.NONE);
      }
      await queue.updateNowPlayingButtons(queue.player?.state?.status === 'paused');
      await interaction.reply({ embeds: [loopEmbed(queue.getLoopInfo())], ephemeral: true });

    } else if (id === 'ctrl_vol_up') {
      const newVol = Math.min(100, Math.round(queue.volume * 100) + 10);
      queue.setVolume(newVol);
      await interaction.reply({ embeds: [successEmbed(`🔊 الصوت: **${newVol}%**`)], ephemeral: true });

    } else if (id === 'ctrl_vol_down') {
      const newVol = Math.max(10, Math.round(queue.volume * 100) - 10);
      queue.setVolume(newVol);
      await interaction.reply({ embeds: [successEmbed(`🔉 الصوت: **${newVol}%**`)], ephemeral: true });

    } else if (id === 'ctrl_queue') {
      const embed = queueEmbed(queue.getCurrentTrack(), queue.getQueue());
      await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (id === 'ctrl_shuffle') {
      const tracks = queue.getQueue();
      for (let i = tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      }
      await interaction.reply({ embeds: [successEmbed('🔀 تم تبديل ترتيب القائمة عشوائياً')], ephemeral: true });

    } else if (id === 'ctrl_seek') {
      const current = queue.getCurrentTrack();
      if (!current) {
        return interaction.reply({ embeds: [errorEmbed('لا توجد أغنية تعزف حالياً!')], ephemeral: true });
      }
      const posSec = Math.floor((queue.getPosition() + 10000) / 1000);
      queue.seek(posSec);
      await interaction.reply({ embeds: [successEmbed('⏩ تم تقديم 10 ثواني')], ephemeral: true });

    } else if (id === 'ctrl_stay') {
      const voiceChannel = interaction.member?.voice?.channel;
      if (queue.isStayEnabled()) {
        queue.disableStay();
        await interaction.reply({ embeds: [stayEmbed(false, null)], ephemeral: true });
        await queue.updateNowPlayingButtons(queue.player?.state?.status === 'paused');
      } else {
        if (!voiceChannel) {
          return interaction.reply({ embeds: [errorEmbed('يجب أن تكون في قناة صوتية لتفعيل وضع البقاء!')], ephemeral: true });
        }
        await queue.joinChannel(voiceChannel.id, interaction.guild).catch(() => {});
        const until = queue.enableStay();
        await interaction.reply({ embeds: [stayEmbed(true, until)], ephemeral: true });
        await queue.updateNowPlayingButtons(queue.player?.state?.status === 'paused');
      }

    } else if (id.startsWith('dl_audio_')) {
      const key = id.replace('dl_audio_', '');
      const url = pendingDownloads.get(key);
      if (!url) {
        return interaction.reply({ embeds: [errorEmbed('انتهت صلاحية هذا الزر. أعد استخدام `/download` مجدداً.')], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ embeds: [infoEmbed('⏳ جاري تحميل الصوت...', 'انتظر قليلاً...')] });
      try {
        const result = await downloadMedia(url, 'audio');
        const { path: filePath, sizeMB } = result;
        if (sizeMB > 25) {
          cleanupFile(filePath);
          return interaction.editReply({ embeds: [errorEmbed(`حجم الملف (${sizeMB.toFixed(1)} MB) يتجاوز حد Discord (25 MB).`)], ephemeral: true });
        }
        await interaction.editReply({
          embeds: [],
          files: [{ attachment: filePath, name: `audio_${Date.now()}.mp3` }],
        });
        setTimeout(() => cleanupFile(filePath), 30000);
        pendingDownloads.delete(key);
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed(`فشل التحميل: ${err.message}`)], ephemeral: true });
      }

    } else {
      await interaction.reply({ embeds: [errorEmbed('زر غير معروف')], ephemeral: true });
    }
  } catch (err) {
    console.error('خطأ في معالجة الزر:', err.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [errorEmbed('حدث خطأ في معالجة هذا الأمر')], ephemeral: true }).catch(() => {});
    }
  }
}

async function getVoiceChannel(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({ embeds: [errorEmbed('يجب أن تكون في قناة صوتية أولاً! 🎤')], ephemeral: true });
    return null;
  }
  return voiceChannel;
}

async function handlePlay(interaction) {
  await interaction.deferReply();

  const voiceChannel = await getVoiceChannel(interaction);
  if (!voiceChannel) return;

  const query = interaction.options.getString('query');
  const queue = getQueue(interaction.guildId);
  queue.setTextChannel(interaction.channel);

  await interaction.editReply({ embeds: [infoEmbed('🔍 جاري البحث...', `البحث عن: **${query}**`)] });

  let trackInfo;
  try {
    trackInfo = await queue.search(query);
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(`لم أجد نتائج: ${err.message}`)] });
  }

  try {
    await queue.joinChannel(voiceChannel.id, interaction.guild);
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(err.message)] });
  }

  const wasPlaying = queue.isPlaying;
  const requester = `<@${interaction.user.id}>`;
  const track = await queue.addTrack(trackInfo, requester);

  if (wasPlaying) {
    await interaction.editReply({ embeds: [addedToQueueEmbed(track, queue.getQueue().length)] });
  } else {
    await interaction.editReply({ embeds: [infoEmbed('🎵 جاري التحميل...', `**${track.title}**`)] });
  }
}

async function handleDownload(interaction) {
  await interaction.deferReply();

  const url = interaction.options.getString('url');
  const format = interaction.options.getString('format') || 'both';

  await interaction.followUp({
    embeds: [infoEmbed('⏳ جاري التحميل...', 'انتظر قليلاً...')],
    ephemeral: true,
  });

  try {
    const result = await downloadMedia(url, format);
    const { path: filePath, sizeMB } = result;

    if (sizeMB > 25) {
      cleanupFile(filePath);
      return interaction.editReply({
        embeds: [errorEmbed(`حجم الملف (${sizeMB.toFixed(1)} MB) يتجاوز حد Discord (25 MB).\n\nجرّب تحميل الصوت فقط.`)]
      });
    }

    const ext = format === 'audio' ? 'mp3' : 'mp4';

    await interaction.editReply({
      embeds: [],
      files: [{ attachment: filePath, name: `download_${Date.now()}.${ext}` }],
    });

    setTimeout(() => cleanupFile(filePath), 30000);

    if (format !== 'audio') {
      const key = `${interaction.id}_${Date.now()}`;
      pendingDownloads.set(key, url);
      setTimeout(() => pendingDownloads.delete(key), 5 * 60 * 1000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dl_audio_${key}`)
          .setLabel('اضغط هنا لتنزيل الصوت فقط 🎵')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.followUp({
        embeds: [infoEmbed('💡 هل تريد الصوت فقط؟', 'اضغط الزر للحصول على نسخة MP3 بدون فيديو.')],
        components: [row],
        ephemeral: true,
      });
    }
  } catch (err) {
    await interaction.editReply({
      embeds: [errorEmbed(`فشل التحميل:\n${err.message}`)]
    });
  }
}

client.login(TOKEN);
