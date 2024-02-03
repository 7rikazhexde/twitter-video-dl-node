const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const tvdl = require('./src/twitter_video_dl/twitter_video_dl');

const argv = yargs(hideBin(process.argv))
    .command('$0 <twitter_url> <file_name>', 'Download a video from a twitter url and save it as a local mp4 file.', (yargs) => {
        yargs.positional('twitter_url', {
            describe: 'Twitter URL to download. e.g. https://x.com/tw_7rikazhexde/status/1710868951109124552?s=20',
            type: 'string'
        }).positional('file_name', {
            describe: 'Save twitter video to this filename. e.g. twittervid',
            type: 'string'
        });
    })
    .help()
    .alias('help', 'h')
    .argv;

tvdl.download_video(argv.twitter_url, argv.file_name);
