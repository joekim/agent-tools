import unittest,tempfile,json,struct,hashlib,io
from pathlib import Path
from civitai_import import parse_url,choose,import_model,validate_weights

def weights():
    h=json.dumps({'lora_unet_test.lora_down.weight':{'dtype':'F32','shape':[1],'data_offsets':[0,4]}}).encode()
    return struct.pack('<Q',len(h))+h+b'\0'*4
class Response(io.BytesIO):
    def __init__(self,data):super().__init__(data);self.headers={'Content-Length':str(len(data))}
class ImportTests(unittest.TestCase):
    def card(self,data):return {'name':'Test adapter','type':'LORA','modelVersions':[{'id':88,'name':'v1','baseModel':'Illustrious','trainedWords':['test trigger'],'files':[{'id':9,'type':'Model','name':'example.safetensors','primary':True,'metadata':{'format':'SafeTensor'},'hashes':{'SHA256':hashlib.sha256(data).hexdigest()},'downloadUrl':'https://civitai.com/api/download/models/88'}]}]}
    def test_urls(self):
        self.assertEqual(parse_url('https://civitai.com/models/7/test?modelVersionId=88'),(7,88))
        for url in ['http://civitai.com/models/1','https://evil.com/models/1','https://civitai.com@evil.com/models/1','https://civitai.com/models/1?modelVersionId=abc','https://civitai.com:999/models/1']:
            with self.assertRaises(ValueError):parse_url(url)
    def test_red_urls(self):
        for host in ['civitai.red','www.civitai.red']:
            self.assertEqual(parse_url(f'https://{host}/models/7/test?modelVersionId=88'),(7,88))
            self.assertEqual(parse_url(f'https://{host}/models/7'),(7,None))
        for url in ['https://civitai.red.evil.test/models/7','https://civitai.red@evil.test/models/7','http://civitai.red/models/7']:
            with self.assertRaises(ValueError):parse_url(url)
    def test_version_and_architecture(self):
        c=self.card(weights())
        with self.assertRaises(ValueError):choose(c,99)
        c['modelVersions'][0]['baseModel']='Flux.1 D'
        with self.assertRaises(ValueError):choose(c,None)
    def test_end_to_end_reuse_and_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);configs=root/'configs';configs.mkdir();models=root/'models';(models/'checkpoints').mkdir(parents=True)
            (models/'checkpoints'/'waiIllustriousSDXL_v170.safetensors').write_bytes(b'base')
            data=weights();card=self.card(data);events=[];downloads=[]
            def get(url,token):downloads.append(url);return Response(data)
            kwargs=dict(url='https://civitai.com/models/7?modelVersionId=88',name='My adapter',base_id='',config_dir=configs,models_dir=models,report=lambda **k:events.append(k),get_meta=lambda *a:card,get_remote=get,downloads_dir=root/'downloads')
            c=import_model(**kwargs)
            self.assertEqual(c['triggers'],['test trigger']);self.assertEqual(c['checkpoint'],'waiIllustriousSDXL_v170.safetensors');self.assertEqual(events[-1]['status'],'completed')
            import_model(**kwargs);self.assertEqual(len(downloads),1)
            self.assertEqual(len(list(configs.glob('*.json'))),1)
            card['modelVersions'][0]['id']=89;card['modelVersions'][0]['files'][0]['hashes']['SHA256']='0'*64;kwargs['url']='https://civitai.com/models/7'
            with self.assertRaises(ValueError):import_model(**kwargs)
            self.assertFalse(list((models/'loras').glob('*.part')));self.assertEqual(len(list(configs.glob('*.json'))),1)
    def test_manual_download_fallback(self):
        for valid in [True,False]:
            with self.subTest(valid=valid),tempfile.TemporaryDirectory() as d:
                root=Path(d);configs=root/'configs';configs.mkdir();models=root/'models'
                (models/'checkpoints').mkdir(parents=True)
                (models/'checkpoints'/'waiIllustriousSDXL_v170.safetensors').write_bytes(b'base')
                downloads=root/'Downloads';downloads.mkdir();data=weights();events=[]
                # Browser duplicate names and renamed files are found by hash, not name.
                local=downloads/'renamed (1).safetensors';local.write_bytes(data if valid else b'wrong model')
                (downloads/'example.safetensors.crdownload').write_bytes(data)
                def denied(*args):raise ValueError('Access denied')
                kwargs=dict(url='https://civitai.com/models/7',name='',base_id='',config_dir=configs,models_dir=models,report=lambda **k:events.append(k),get_meta=lambda *a:self.card(data),get_remote=denied,downloads_dir=downloads)
                if valid:
                    c=import_model(**kwargs)
                    self.assertEqual((models/'loras'/c['lora']).read_bytes(),data)
                    self.assertEqual(events[-1]['status'],'completed')
                    self.assertTrue(any(e['status']=='installing' for e in events))
                else:
                    with self.assertRaisesRegex(ValueError,'No verified matching'):import_model(**kwargs)
                    self.assertFalse(list(configs.glob('*.json')))
                self.assertTrue(local.exists());self.assertFalse(list((models/'loras').glob('*.part')))

    def test_missing_base_and_html(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'html';p.write_bytes(b'<html>Login required</html>')
            with self.assertRaises(ValueError):validate_weights(p,'LORA')
            with self.assertRaises(ValueError):import_model('https://civitai.com/models/7','','',root,root,lambda **k:None,get_meta=lambda *a:self.card(weights()))
if __name__=='__main__':unittest.main()
