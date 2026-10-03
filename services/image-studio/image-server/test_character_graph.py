import unittest
from studio_models import build_graph
class CharacterGraphTests(unittest.TestCase):
    def test_character_recipe(self):
        c={'checkpoint':'base.safetensors','lora':'hero.safetensors','triggers':['hero'], 'promptPrefix':'gray hair, green robe','negativePrompt':'blurry','cfg':5.5}
        g,_=build_graph('imported-sdxl','drinking tea',1024,1024,25,1,.7,configuration=c)
        self.assertEqual(g['4']['inputs']['text'],'hero, gray hair, green robe, drinking tea')
        self.assertEqual(g['5']['inputs']['text'],'blurry')
        self.assertEqual(g['7']['inputs']['cfg'],5.5)
        self.assertEqual(g['2']['inputs']['lora_name'],'hero.safetensors')
        self.assertEqual(g['2']['inputs']['strength_model'],.7)
        g,_=build_graph('imported-sdxl','drinking tea',1024,1024,25,1,0,configuration=c)
        self.assertEqual(g['4']['inputs']['text'],'gray hair, green robe, drinking tea')
    def test_image_to_image(self):
        c={'checkpoint':'pixel.safetensors','lora':None,'triggers':[]}
        g,_=build_graph('imported-sdxl','pixel village',768,1024,25,1,.75,'source.png',c,.35)
        self.assertEqual(g['6']['class_type'],'VAEEncode')
        self.assertEqual(g['6']['inputs']['vae'],['1',2])
        self.assertEqual(g['10']['inputs']['image'],'source.png')
        self.assertEqual(g['11']['inputs']['width'],768)
        self.assertEqual(g['7']['inputs']['denoise'],.35)
        self.assertEqual(g['7']['inputs']['latent_image'],['6',0])
        self.assertNotIn('2',g)
        c['lora']='character.safetensors'
        g,_=build_graph('imported-sdxl','tea',1024,1024,25,1,.6,'source.png',c,1)
        self.assertEqual(g['2']['inputs']['lora_name'],'character.safetensors')
        self.assertEqual(g['7']['inputs']['denoise'],1)

    def test_pose_conditioning(self):
        c={'checkpoint':'base','lora':'character','triggers':['hero']}
        g,_=build_graph('imported-sdxl','standing',768,1024,25,1,.8,configuration=c,pose_name='pose.jpg',pose_strength=.7)
        self.assertEqual(g['22']['class_type'],'SDPoseKeypointExtractor')
        self.assertEqual(g['20']['inputs']['image'],'pose.jpg')
        self.assertEqual(g['7']['inputs']['positive'],['26',0])
        self.assertEqual(g['7']['inputs']['negative'],['26',1])
        self.assertEqual(g['26']['inputs']['strength'],.7)
        self.assertFalse(g['23']['inputs']['draw_face'])
        self.assertEqual(g['2']['inputs']['lora_name'],'character')
        self.assertEqual(g['27']['inputs']['images'],['24',0])

    def test_legacy_configuration(self):
        g,_=build_graph('imported-sdxl','tea',1024,1024,25,1,.75,configuration={'checkpoint':'base','lora':'hero','triggers':['hero']})
        self.assertEqual(g['4']['inputs']['text'],'hero, tea')
        self.assertEqual(g['5']['inputs']['text'],'')
if __name__=='__main__':unittest.main()
