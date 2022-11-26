const SftpClient = require('ssh2-sftp-client');
const sftp = new SftpClient();

const util = require('util');
const glob = util.promisify(require('glob'));
const upath = require('upath');
const fs = require('fs');

const remotePathBase = '/home4/nbarbettini/public_html';
const ignoredRemoteItems = new Set(['.well-known', 'cgi-bin', '.htaccess', 'favicon.ico']);

let itemsToUpload = [];

if (!process.env.FTP_DEPLOY_HOST) throw new Error('FTP_DEPLOY_HOST not set');
if (!process.env.FTP_DEPLOY_PORT) throw new Error('FTP_DEPLOY_PORT not set');
if (!process.env.FTP_DEPLOY_USERNAME) throw new Error('FTP_DEPLOY_USERNAME not set');
if (!process.env.FTP_DEPLOY_PASSWORD) throw new Error('FTP_DEPLOY_PASSWORD not set');

sftp.connect({
  host: process.env.FTP_DEPLOY_HOST,
  port: process.env.FTP_DEPLOY_PORT,
  username: process.env.FTP_DEPLOY_USERNAME,
  password: process.env.FTP_DEPLOY_PASSWORD
})
.then(() => scanLocalFiles())
.then(items => {
  if (!items || items.length < 1) throw new Error('Nothing to upload!');

  itemsToUpload = items;
})
.then(() => cleanRemote())
.then(() => createDirectoriesFor(itemsToUpload))
.then(() => uploadFiles(itemsToUpload))
.then(() => sftp.end())
.catch(err => {
  sftp.end();
  console.error(err);
  process.exit(1);
});

function scanLocalFiles() {
  let localPublicDir = upath.join(process.cwd(), 'public');

  return glob(`${localPublicDir}/**/*`).then(globMatches => {
    let items = globMatches.map(path => {
      return {
        isDirectory: fs.lstatSync(path).isDirectory(),
        localPath: path,
        remotePath: upath.join(
          remotePathBase,
          upath.relative(localPublicDir, path)
        )
      }
    });

    return items;
  })
}

function cleanRemote() {
  console.log('\nCleaning remote server');

  return sftp
    .list(remotePathBase)
    .then(objectList => {
      objectList = objectList.filter(obj => !ignoredRemoteItems.has(obj.name));

      let directoriesToRemove = objectList
        .filter(obj => obj.type === 'd')
        .map(obj => obj.name);

      let filesToRemove = objectList
        .filter(obj => obj.type === '-')
        .map(obj => obj.name);

      let operations = directoriesToRemove.map(dir => 
        sftp.rmdir(upath.join(remotePathBase, dir), true)
        .then(() => console.log(`Removed directory ${dir}`)))
      .concat(filesToRemove.map(file =>
        sftp.delete(upath.join(remotePathBase, file))
        .then(() => console.log(`Removed file ${file}`))));

      return Promise.all(operations);
    })
}

function createDirectoriesFor(items) {
  console.log('Creating directories');

  let directoriesToCreate = items.filter(path => path.isDirectory);

  return Promise.all(directoriesToCreate.map(dir =>
    sftp.mkdir(dir.remotePath, true)
    .then(() => console.log(`Created directory ${dir.remotePath}`))));
}

function uploadFiles(items) {
  console.log('Uploading files');

  let filesToUpload = items.filter(path => !path.isDirectory);

  return Promise.all(filesToUpload.map(file =>
    sftp.put(file.localPath, file.remotePath)
    .then(() => console.log(`Uploaded file ${file.remotePath}`))));
}

