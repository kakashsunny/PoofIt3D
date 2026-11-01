import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from app.services.quality import silhouette_iou
sk=Image.new('RGB',(512,512),'white'); d=ImageDraw.Draw(sk); d.ellipse((120,150,400,380),outline='black',width=6)   # oval outline sketch
def gen(shape):
    im=Image.new('RGB',(768,768),(235,235,235)); d=ImageDraw.Draw(im)
    if shape=='oval': d.ellipse((200,260,560,520),fill=(200,40,40))
    if shape=='square': d.rectangle((250,150,520,620),fill=(40,40,200))
    if shape=='tall': d.rectangle((330,100,430,680),fill=(40,160,40))
    return im
for s in ('oval','square','tall'): print(s, round(silhouette_iou(sk,gen(s)),3))
